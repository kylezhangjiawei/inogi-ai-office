import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ChevronDown,
  Crown,
  FileText,
  MousePointerClick,
  Pencil,
  Plus,
  RefreshCw,
  Shield,
  Sparkles,
  Trash2,
  User,
  Users,
} from "lucide-react";
import { toast } from "sonner";

import { authFetch } from "./lib/authSession";
import { cn } from "./components/ui/utils";
import { PermissionGuard } from "./components/PermissionGuard";
import { PermissionCatalogGroup, permissionCatalogApi } from "./lib/permissionCatalogApi";
import { Button } from "./components/ui/button";
import { Input } from "./components/ui/input";
import { Textarea } from "./components/ui/textarea";
import { Label } from "./components/ui/label";
import { Badge } from "./components/ui/badge";
import { Checkbox } from "./components/ui/checkbox";
import { Progress } from "./components/ui/progress";
import { Separator } from "./components/ui/separator";
import { Tooltip, TooltipContent, TooltipTrigger } from "./components/ui/tooltip";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "./components/ui/dialog";

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

function getGroupIcon(label: string) {
  if (label.startsWith("操作权限") || label.includes("操作")) {
    return MousePointerClick;
  }
  return FileText;
}

function computeInitialCollapsed(
  groups: PermissionCatalogGroup[],
  selected: string[],
  isWildcard: boolean,
): Record<string, boolean> {
  if (isWildcard) return {};
  const next: Record<string, boolean> = {};
  for (const group of groups) {
    const hasAnySelected = group.permissions.some((p) => selected.includes(p.code));
    if (!hasAnySelected) next[group.label] = true;
  }
  return next;
}

function PermissionMatrix({
  selected,
  onChange,
  isWildcard,
  groups,
}: {
  selected: string[];
  onChange: (permissions: string[]) => void;
  isWildcard: boolean;
  groups: PermissionCatalogGroup[];
}) {
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>(() =>
    computeInitialCollapsed(groups, selected, isWildcard),
  );

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
      onChange(Array.from(new Set([...selected, ...codes])));
    }
  }

  return (
    <div className="space-y-2.5">
      {groups.map((group) => {
        const groupCodes = group.permissions.map((p) => p.code);
        const selectedCount = isWildcard
          ? groupCodes.length
          : groupCodes.filter((c) => selected.includes(c)).length;
        const allSelected = selectedCount === groupCodes.length;
        const noneSelected = selectedCount === 0;
        const isOpen = !collapsed[group.label];
        const Icon = getGroupIcon(group.label);
        const progress = groupCodes.length === 0 ? 0 : (selectedCount / groupCodes.length) * 100;

        return (
          <div
            key={group.label}
            className={cn(
              "overflow-hidden rounded-lg border transition-colors duration-200",
              allSelected
                ? "border-emerald-200 bg-emerald-50/40"
                : !noneSelected
                  ? "border-blue-200 bg-blue-50/30"
                  : "border-slate-200 bg-white",
            )}
          >
            {/* Group header */}
            <button
              type="button"
              onClick={() => toggleGroup(group.label)}
              className="group/grp flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-slate-50/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-200"
            >
              <Checkbox
                checked={allSelected ? true : selectedCount > 0 ? "indeterminate" : false}
                disabled={isWildcard}
                onCheckedChange={() => {
                  if (!isWildcard) toggleGroupAll(groupCodes);
                }}
                onClick={(e) => e.stopPropagation()}
                className={cn(
                  "shrink-0",
                  allSelected && "data-[state=checked]:bg-emerald-500 data-[state=checked]:border-emerald-500",
                )}
              />
              <span
                className={cn(
                  "flex h-7 w-7 shrink-0 items-center justify-center rounded-md transition-colors",
                  allSelected
                    ? "bg-emerald-100 text-emerald-600"
                    : !noneSelected
                      ? "bg-blue-100 text-blue-600"
                      : "bg-slate-100 text-slate-400",
                )}
              >
                <Icon className="h-3.5 w-3.5" />
              </span>
              <span className="flex-1 text-sm font-semibold text-slate-800">{group.label}</span>

              {/* Progress + count */}
              <div className="flex items-center gap-2.5 shrink-0">
                <span
                  className={cn(
                    "text-xs tabular-nums font-medium",
                    allSelected
                      ? "text-emerald-600"
                      : !noneSelected
                        ? "text-blue-600"
                        : "text-slate-400",
                  )}
                >
                  {selectedCount}/{groupCodes.length}
                </span>
                <Progress
                  value={progress}
                  className={cn(
                    "w-16 h-1.5 transition-colors",
                    allSelected ? "bg-emerald-100 [&>[data-slot=progress-indicator]]:bg-emerald-500" :
                      !noneSelected ? "bg-blue-100 [&>[data-slot=progress-indicator]]:bg-blue-500" :
                        "bg-slate-100 [&>[data-slot=progress-indicator]]:bg-slate-400",
                  )}
                />
                <ChevronDown
                  className={cn(
                    "h-4 w-4 text-slate-400 transition-transform duration-200 ease-out",
                    isOpen && "rotate-180",
                  )}
                />
              </div>
            </button>

            {/* Animated permission grid */}
            <div
              className={cn(
                "grid transition-all duration-300 ease-out",
                isOpen ? "grid-rows-[1fr]" : "grid-rows-[0fr]",
              )}
            >
              <div className="overflow-hidden">
                <div className="border-t border-slate-100 bg-white">
                  <div className="grid grid-cols-1 gap-2 p-3 sm:grid-cols-2 md:grid-cols-3">
                    {group.permissions.map((perm) => {
                      const checked = isWildcard || selected.includes(perm.code);
                      const ItemIcon = perm.type === "action" ? MousePointerClick : FileText;
                      return (
                        <label
                          key={perm.code}
                          className={cn(
                            "group/perm flex cursor-pointer items-start gap-2.5 rounded-md border p-2.5 text-sm transition-all duration-150",
                            checked
                              ? "border-blue-200 bg-blue-50/70 hover:border-blue-300"
                              : "border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50",
                            isWildcard && "cursor-default opacity-70",
                          )}
                        >
                          <Checkbox
                            checked={checked}
                            disabled={isWildcard}
                            onCheckedChange={() => {
                              if (!isWildcard) togglePermission(perm.code);
                            }}
                            className="mt-0.5 shrink-0"
                          />
                          <ItemIcon
                            className={cn(
                              "mt-0.5 h-3.5 w-3.5 shrink-0 transition-colors",
                              checked ? "text-blue-500" : "text-slate-300 group-hover/perm:text-slate-400",
                            )}
                          />
                          <div className="min-w-0 flex-1">
                            <div className={cn(
                              "text-sm font-medium transition-colors leading-tight",
                              checked ? "text-blue-800" : "text-slate-700",
                            )}>
                              {perm.label}
                            </div>
                            {perm.description && (
                              <div className="mt-0.5 text-[11px] text-slate-400 line-clamp-2 leading-snug">
                                {perm.description}
                              </div>
                            )}
                          </div>
                        </label>
                      );
                    })}
                  </div>
                </div>
              </div>
            </div>
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
  const [permissionGroups, setPermissionGroups] = useState<PermissionCatalogGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeRoleId, setActiveRoleId] = useState<string | null>(null);

  const [dialogMode, setDialogMode] = useState<DialogMode>(null);
  const [selectedRole, setSelectedRole] = useState<Role | null>(null);
  const [form, setForm] = useState<RoleFormData>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);

  const loadRoles = useCallback(async () => {
    setLoading(true);
    try {
      const [data, groups] = await Promise.all([
        apiListRoles(),
        permissionCatalogApi.listGroups(),
      ]);
      setRoles(data);
      setPermissionGroups(groups);
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

  const totalPermissions = useMemo(
    () => permissionGroups.reduce((sum, g) => sum + g.permissions.length, 0),
    [permissionGroups],
  );

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
    <div className="mx-auto max-w-7xl space-y-5 animate-rd-fade-in">
      {/* ── Header ──────────────────────────────────────────────────── */}
      <section className="material-card overflow-hidden">
        <div className="h-0.5 bg-indigo-600" />
        <div className="flex flex-col gap-4 p-6 lg:flex-row lg:items-center lg:justify-between md:p-8">
          <div className="min-w-0">
            <span className="material-chip bg-indigo-50 text-indigo-700 text-xs tracking-wide">
              Permission Matrix
            </span>
            <h2 className="mt-3 text-2xl font-bold tracking-tight text-slate-950 sm:text-[1.75rem]">
              角色与权限
            </h2>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-500">
              配置角色的页面访问权限与操作权限。权限变更实时生效——用户下次刷新 Token 后即可感知。
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2.5 shrink-0">
            <div className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs">
              <Users className="h-3.5 w-3.5 text-slate-400" />
              <span className="text-slate-500">角色</span>
              <span className="font-bold text-slate-800">{roles.length}</span>
              <Separator orientation="vertical" className="mx-1.5 h-3.5" />
              <Shield className="h-3.5 w-3.5 text-slate-400" />
              <span className="text-slate-500">权限项</span>
              <span className="font-bold text-slate-800">{totalPermissions}</span>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => void loadRoles()}
              disabled={loading}
              className="gap-1.5"
            >
              <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
              刷新
            </Button>
            <PermissionGuard permission="role:create">
              <Button size="sm" onClick={openCreate} className="gap-1.5">
                <Plus className="h-3.5 w-3.5" />
                新建角色
              </Button>
            </PermissionGuard>
          </div>
        </div>
      </section>

      <section className="grid gap-4 xl:grid-cols-[300px_minmax(0,1fr)] xl:gap-5">
        {/* ── Role list ──────────────────────────────────────────── */}
        <div className="material-card p-3">
          {loading ? (
            <div className="flex flex-col items-center justify-center gap-2 py-12 text-slate-400">
              <RefreshCw className="h-5 w-5 animate-spin" />
              <span className="text-sm">加载中…</span>
            </div>
          ) : roles.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 py-12 text-slate-400">
              <Users className="h-6 w-6 text-slate-200" />
              <span className="text-sm">暂无角色</span>
            </div>
          ) : (
            <div className="space-y-1.5">
              {roles.map((role) => {
                const isActive = activeRoleId === role.id;
                const isSuper = role.permissions.includes("*");
                const userCount = role._count?.users ?? 0;
                const RoleIcon = isSuper ? Crown : User;

                return (
                  <div
                    key={role.id}
                    onClick={() => setActiveRoleId(role.id)}
                    className={cn(
                      "group/role relative flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-all duration-200",
                      isActive
                        ? "border-indigo-200 bg-indigo-50 shadow-[0_1px_2px_rgba(15,23,42,0.04)]"
                        : "border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50/60",
                    )}
                  >
                    {/* Left active accent */}
                    {isActive && (
                      <span className="absolute left-0 top-2 bottom-2 w-0.5 rounded-r bg-indigo-600" />
                    )}

                    {/* Role icon */}
                    <span
                      className={cn(
                        "flex h-8 w-8 shrink-0 items-center justify-center rounded-md transition-colors",
                        isSuper
                          ? "bg-linear-to-br from-amber-100 to-orange-100 text-amber-600 ring-1 ring-amber-200"
                          : isActive
                            ? "bg-indigo-100 text-indigo-600 ring-1 ring-indigo-200"
                            : "bg-slate-100 text-slate-500 ring-1 ring-slate-200 group-hover/role:bg-slate-200",
                      )}
                    >
                      <RoleIcon className="h-4 w-4" />
                    </span>

                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <span
                          className={cn(
                            "truncate text-sm font-semibold",
                            isActive ? "text-indigo-700" : "text-slate-800",
                          )}
                        >
                          {role.name}
                        </span>
                        {isSuper && (
                          <Badge className="shrink-0 h-4 px-1 text-[10px] font-bold gap-0.5 bg-linear-to-r from-amber-400 to-orange-400 text-white border-0 hover:from-amber-500 hover:to-orange-500">
                            <Sparkles className="h-2 w-2" />
                            超级
                          </Badge>
                        )}
                      </div>
                      {role.description && (
                        <div className="mt-0.5 text-xs text-slate-400 line-clamp-2 leading-snug">
                          {role.description}
                        </div>
                      )}
                      <div className="mt-1.5 flex items-center gap-2 text-[11px] text-slate-500">
                        <span className="flex items-center gap-0.5">
                          <Users className="h-2.5 w-2.5" />
                          {userCount}
                        </span>
                        <span className="text-slate-300">·</span>
                        <span>
                          {isSuper ? "全部权限" : `${role.permissions.length} 项`}
                        </span>
                      </div>
                    </div>

                    {/* Actions (hover) */}
                    {!isSuper && (
                      <div className="ml-1 flex shrink-0 gap-0.5 opacity-0 transition-opacity duration-150 group-hover/role:opacity-100">
                        <PermissionGuard permission="role:edit">
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-6 w-6 text-slate-500 hover:text-indigo-600 hover:bg-indigo-50"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  openEdit(role);
                                }}
                              >
                                <Pencil className="h-3 w-3" />
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent side="top" sideOffset={4}>编辑</TooltipContent>
                          </Tooltip>
                        </PermissionGuard>
                        <PermissionGuard permission="role:delete">
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-6 w-6 text-slate-400 hover:text-red-500 hover:bg-red-50"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  openDelete(role);
                                }}
                              >
                                <Trash2 className="h-3 w-3" />
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent side="top" sideOffset={4}>删除</TooltipContent>
                          </Tooltip>
                        </PermissionGuard>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* ── Permission matrix for active role ────────────────── */}
        <div className="material-card min-w-0 p-4 sm:p-6">
          {!activeRole ? (
            <div className="flex h-48 flex-col items-center justify-center gap-2 text-slate-400">
              <Shield className="h-8 w-8 text-slate-200" />
              <span className="text-sm">请从左侧选择角色</span>
            </div>
          ) : (
            <>
              <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span
                      className={cn(
                        "flex h-9 w-9 shrink-0 items-center justify-center rounded-lg",
                        isWildcard
                          ? "bg-linear-to-br from-amber-100 to-orange-100 text-amber-600 ring-1 ring-amber-200"
                          : "bg-indigo-100 text-indigo-600 ring-1 ring-indigo-200",
                      )}
                    >
                      {isWildcard ? <Crown className="h-4 w-4" /> : <User className="h-4 w-4" />}
                    </span>
                    <h3 className="text-lg font-bold text-slate-900">{activeRole.name}</h3>
                    {isWildcard && (
                      <Badge className="h-5 px-1.5 text-[11px] font-bold gap-0.5 bg-linear-to-r from-amber-400 to-orange-400 text-white border-0">
                        <Sparkles className="h-2.5 w-2.5" />
                        超级权限
                      </Badge>
                    )}
                  </div>
                  {activeRole.description && (
                    <p className="mt-1.5 text-sm text-slate-500 leading-6">{activeRole.description}</p>
                  )}
                  {isWildcard && (
                    <div className="mt-3 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700 leading-5">
                      <Sparkles className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                      <span>该角色拥有超级权限（*），可访问所有功能。若要限制权限，请编辑角色并手动指定权限列表。</span>
                    </div>
                  )}
                </div>
                {!isWildcard && (
                  <PermissionGuard permission="role:edit">
                    <Button size="sm" onClick={() => openEdit(activeRole)} className="shrink-0 gap-1.5">
                      <Pencil className="h-3.5 w-3.5" />
                      编辑角色
                    </Button>
                  </PermissionGuard>
                )}
              </div>

              <Separator className="mb-4" />

              <PermissionMatrix
                key={activeRole.id}
                selected={activeRole.permissions}
                isWildcard={isWildcard}
                groups={permissionGroups}
                onChange={(permissions) => {
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

      {/* ── Create / Edit Dialog ─────────────────────────────────── */}
      <Dialog
        open={dialogMode === "create" || dialogMode === "edit"}
        onOpenChange={(open) => !open && closeDialog()}
      >
        <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {dialogMode === "edit" ? (
                <><Pencil className="h-4 w-4 text-indigo-500" />编辑角色</>
              ) : (
                <><Plus className="h-4 w-4 text-indigo-500" />新建角色</>
              )}
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-[1fr_2fr]">
              <div className="space-y-1.5">
                <Label htmlFor="role-name">
                  角色名称 <span className="text-red-500">*</span>
                </Label>
                <Input
                  id="role-name"
                  value={form.name}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                  placeholder="请输入角色名称"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="role-desc">角色说明</Label>
                <Textarea
                  id="role-desc"
                  rows={1}
                  value={form.description}
                  onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                  placeholder="简要说明该角色的职责范围"
                  className="min-h-9"
                />
              </div>
            </div>

            <Separator />

            <div className="flex items-center justify-between">
              <Label className="flex items-center gap-1.5 text-sm font-semibold text-slate-700">
                <Shield className="h-3.5 w-3.5 text-slate-400" />
                权限配置
              </Label>
              <span className="text-xs text-slate-400">
                已选 <strong className="text-slate-700 tabular-nums">{form.permissions.filter((p) => p !== "*").length}</strong> 项 / 共 {totalPermissions} 项
              </span>
            </div>

            <PermissionMatrix
              selected={form.permissions}
              isWildcard={form.permissions.includes("*")}
              groups={permissionGroups}
              onChange={(permissions) => setForm((f) => ({ ...f, permissions }))}
            />
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={closeDialog} disabled={saving}>
              取消
            </Button>
            <Button onClick={() => void handleSaveRole()} disabled={saving} className="gap-1.5">
              {saving && <RefreshCw className="h-3.5 w-3.5 animate-spin" />}
              {saving ? "保存中…" : "保存角色"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Delete Confirm ───────────────────────────────────────── */}
      <Dialog open={dialogMode === "deleteConfirm"} onOpenChange={(open) => !open && closeDialog()}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Trash2 className="h-4 w-4 text-red-500" />
              确认删除角色
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-sm leading-6 text-slate-600">
              即将永久删除角色「<strong className="text-slate-900">{selectedRole?.name}</strong>」。
            </p>
            {(selectedRole?._count?.users ?? 0) > 0 && (
              <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-600 leading-5">
                <Users className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span>
                  该角色下仍有 <strong>{selectedRole?._count?.users}</strong> 名用户，请先移除或重新分配后再删除。
                </span>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={closeDialog} disabled={saving}>
              取消
            </Button>
            <Button
              variant="destructive"
              onClick={() => void handleDeleteRole()}
              disabled={saving || (selectedRole?._count?.users ?? 0) > 0}
              className="gap-1.5"
            >
              {saving && <RefreshCw className="h-3.5 w-3.5 animate-spin" />}
              {saving ? "删除中…" : "确认删除"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
