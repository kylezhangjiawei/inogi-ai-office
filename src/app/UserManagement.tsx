import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Eye, EyeOff, KeyRound, Pencil, Plus, RefreshCw, Search, Trash2, UserCheck, UserX } from "lucide-react";
import {
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  MenuItem,
  Select,
  SelectChangeEvent,
} from "@mui/material";
import { toast } from "sonner";
import { authFetch } from "./lib/authSession";
import { dictionaryApi, type GenericDictionaryItem } from "./lib/dictionaryApi";
import { useAuth } from "./auth";
import { cn } from "./components/ui/utils";
import { PermissionGuard } from "./components/PermissionGuard";

// ─── 类型 ─────────────────────────────────────────────────────────────────────

type UserStatus = "ACTIVE" | "INVITED" | "DISABLED";

type Role = {
  id: string;
  name: string;
  permissions?: string[];
};

type User = {
  id: string;
  name: string;
  username: string | null;
  email: string;
  department: string | null;
  status: UserStatus;
  roleId: string | null;
  role: { id: string; name: string; permissions: string[] } | null;
  createdAt: string;
  updatedAt: string;
};

type UserFormData = {
  id?: string;
  name: string;
  username: string;
  department: string;
  roleId: string;
  status: UserStatus;
  password: string;
};

const EMPTY_FORM: UserFormData = {
  name: "",
  username: "",
  department: "",
  roleId: "",
  status: "ACTIVE",
  password: "",
};

const STATUS_LABELS: Record<UserStatus, string> = {
  ACTIVE: "启用",
  INVITED: "待分配",
  DISABLED: "停用",
};

const PAGE_SIZE = 10;

// ─── API ──────────────────────────────────────────────────────────────────────

async function apiListUsers(): Promise<User[]> {
  const res = await authFetch("/api/users");
  if (!res.ok) throw new Error("获取用户列表失败");
  return res.json() as Promise<User[]>;
}

async function apiListRoles(): Promise<Role[]> {
  const res = await authFetch("/api/roles/options");
  if (!res.ok) throw new Error("获取角色列表失败");
  return res.json() as Promise<Role[]>;
}

async function apiSaveUser(payload: UserFormData): Promise<User> {
  const res = await authFetch("/api/users", {
    method: "POST",
    body: JSON.stringify({
      id: payload.id,
      name: payload.name,
      username: payload.username || undefined,
      department: payload.department || undefined,
      roleId: payload.roleId || undefined,
      status: payload.status,
      password: !payload.id && payload.password ? payload.password : undefined,
    }),
  });
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { message?: string | string[] };
    const msg = Array.isArray(err.message) ? err.message.join(", ") : (err.message ?? "保存失败");
    throw new Error(msg);
  }
  return res.json() as Promise<User>;
}

async function apiUpdateStatus(id: string, status: UserStatus): Promise<User> {
  const res = await authFetch(`/api/users/${id}/status`, {
    method: "PATCH",
    body: JSON.stringify({ status }),
  });
  if (!res.ok) throw new Error("状态更新失败");
  return res.json() as Promise<User>;
}

async function apiResetPassword(id: string, newPassword: string): Promise<void> {
  const res = await authFetch(`/api/users/${id}/reset-password`, {
    method: "POST",
    body: JSON.stringify({ newPassword }),
  });
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { message?: string };
    throw new Error(err.message ?? "密码修改失败");
  }
}

async function apiDeleteUser(id: string): Promise<void> {
  const res = await authFetch(`/api/users/${id}`, { method: "DELETE" });
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { message?: string };
    throw new Error(err.message ?? "删除用户失败");
  }
}

// ─── 工具函数 ─────────────────────────────────────────────────────────────────

function isSuperAdmin(user: User): boolean {
  return Array.isArray(user.role?.permissions) && user.role!.permissions.includes("*");
}

// ─── 密码单元格 ───────────────────────────────────────────────────────────────

function PasswordCell({
  user,
  currentUserId,
  currentUserIsSuperAdmin,
  onChangePwd,
}: {
  user: User;
  currentUserId: string;
  currentUserIsSuperAdmin: boolean;
  onChangePwd: (user: User) => void;
}) {
  const isSelf = user.id === currentUserId;
  const canChange = isSelf || (currentUserIsSuperAdmin && !isSuperAdmin(user));

  return (
    <div className="flex items-center gap-2">
      <span className="font-mono text-slate-400 tracking-widest text-xs">••••••••</span>
      {canChange && (
        <button
          className="material-button-secondary !px-2 !py-1.5"
          onClick={() => onChangePwd(user)}
          title={isSelf ? "修改我的密码" : "重置密码"}
        >
          <KeyRound className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );
}

// ─── 主组件 ───────────────────────────────────────────────────────────────────

type DialogMode = "create" | "edit" | "changePwd" | "deleteConfirm" | null;

export function UserManagement() {
  const { user: currentUser } = useAuth();
  const currentUserId = currentUser?.id ?? "";
  const currentUserIsSuperAdmin = currentUser?.permissions.includes("*") ?? false;

  const [users, setUsers] = useState<User[]>([]);
  const [roles, setRoles] = useState<Role[]>([]);
  const [departments, setDepartments] = useState<GenericDictionaryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [keyword, setKeyword] = useState("");
  const [statusFilter, setStatusFilter] = useState<"ALL" | UserStatus>("ALL");
  const [page, setPage] = useState(1);

  const [dialogMode, setDialogMode] = useState<DialogMode>(null);
  const [selectedUser, setSelectedUser] = useState<User | null>(null);
  const [form, setForm] = useState<UserFormData>(EMPTY_FORM);
  const [showFormPwd, setShowFormPwd] = useState(false);
  const [newPassword, setNewPassword] = useState("");
  const [showNewPwd, setShowNewPwd] = useState(false);
  const [saving, setSaving] = useState(false);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [usersData, rolesData, typesData] = await Promise.all([
        apiListUsers(),
        apiListRoles(),
        dictionaryApi.listTypes(),
      ]);
      setUsers(usersData);
      setRoles(rolesData);
      const deptType = typesData.find((t) => t.key === "department");
      if (deptType) {
        const res = await dictionaryApi.listItems(deptType.id, { page: 1, pageSize: 100 });
        setDepartments(res.items.filter((i): i is GenericDictionaryItem => i.kind === "generic"));
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "数据加载失败");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void loadData(); }, [loadData]);

  const filteredUsers = useMemo(
    () =>
      users.filter((u) => {
        const q = keyword.toLowerCase();
        const matchKeyword =
          !keyword ||
          u.name.toLowerCase().includes(q) ||
          (u.username ?? "").toLowerCase().includes(q) ||
          (u.department ?? "").toLowerCase().includes(q) ||
          (u.role?.name ?? "").toLowerCase().includes(q);
        const matchStatus = statusFilter === "ALL" || u.status === statusFilter;
        return matchKeyword && matchStatus;
      }),
    [users, keyword, statusFilter],
  );

  useEffect(() => { setPage(1); }, [keyword, statusFilter]);

  const totalPages = Math.max(1, Math.ceil(filteredUsers.length / PAGE_SIZE));
  const pagedUsers = filteredUsers.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  // 可分配给用户的角色（排除超管角色）
  const assignableRoles = roles.filter((r) => !r.permissions?.includes("*"));

  function openCreate() {
    setForm(EMPTY_FORM);
    setShowFormPwd(false);
    setDialogMode("create");
  }

  function openEdit(user: User) {
    setSelectedUser(user);
    setForm({
      id: user.id,
      name: user.name,
      username: user.username ?? "",
      department: user.department ?? "",
      roleId: user.roleId ?? "",
      status: user.status,
      password: "",
    });
    setShowFormPwd(false);
    setDialogMode("edit");
  }

  function openChangePwd(user: User) {
    setSelectedUser(user);
    setNewPassword("");
    setShowNewPwd(false);
    setDialogMode("changePwd");
  }

  function openDelete(user: User) {
    setSelectedUser(user);
    setDialogMode("deleteConfirm");
  }

  function closeDialog() {
    setDialogMode(null);
    setSelectedUser(null);
  }

  async function handleSaveUser() {
    if (!form.name.trim()) {
      toast.error("姓名为必填项");
      return;
    }
    if (!form.id && !form.password.trim()) {
      toast.error("新建用户必须设置初始密码");
      return;
    }
    if (!form.id && form.password.length < 8) {
      toast.error("密码长度至少 8 位");
      return;
    }
    setSaving(true);
    try {
      const saved = await apiSaveUser(form);
      setUsers((prev) => {
        const idx = prev.findIndex((u) => u.id === saved.id);
        if (idx >= 0) {
          const next = [...prev];
          next[idx] = saved;
          return next;
        }
        return [saved, ...prev];
      });
      toast.success(form.id ? "用户信息已更新" : "用户已创建");
      closeDialog();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "保存失败");
    } finally {
      setSaving(false);
    }
  }

  async function handleToggleStatus(user: User) {
    const newStatus: UserStatus = user.status === "DISABLED" ? "ACTIVE" : "DISABLED";
    try {
      const updated = await apiUpdateStatus(user.id, newStatus);
      setUsers((prev) => prev.map((u) => (u.id === updated.id ? updated : u)));
      toast.success(`用户已${newStatus === "ACTIVE" ? "启用" : "停用"}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "操作失败");
    }
  }

  async function handleChangePassword() {
    if (!selectedUser || !newPassword.trim()) {
      toast.error("请输入新密码");
      return;
    }
    if (newPassword.length < 8) {
      toast.error("密码长度至少 8 位");
      return;
    }
    setSaving(true);
    try {
      await apiResetPassword(selectedUser.id, newPassword);
      const isSelf = selectedUser.id === currentUserId;
      toast.success(isSelf ? "密码已修改" : `${selectedUser.name} 的密码已重置`);
      closeDialog();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "操作失败");
    } finally {
      setSaving(false);
    }
  }

  async function handleDeleteUser() {
    if (!selectedUser) return;
    setSaving(true);
    try {
      await apiDeleteUser(selectedUser.id);
      setUsers((prev) => prev.filter((u) => u.id !== selectedUser.id));
      toast.success("用户已删除");
      closeDialog();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "删除失败");
    } finally {
      setSaving(false);
    }
  }

  const isSelf = (user: User) => user.id === currentUserId;
  const changePwdTitle = selectedUser
    ? isSelf(selectedUser)
      ? "修改密码"
      : `重置密码 · ${selectedUser.name}`
    : "修改密码";

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      {/* 页头 */}
      <section className="material-card p-6 md:p-8">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <span className="material-chip bg-blue-50 text-blue-700">User Management</span>
            <h2 className="mt-3 text-[2rem] font-bold tracking-tight text-slate-900">用户管理</h2>
            <p className="mt-2 max-w-2xl text-sm leading-7 text-slate-600">
              管理系统账号、角色分配与状态控制。密码列仅自己可见操作按钮，超级管理员可对所有用户密码进行操作。
            </p>
          </div>
          <div className="flex gap-2">
            <button
              className="material-button-secondary w-fit"
              onClick={() => void loadData()}
              disabled={loading}
            >
              <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
              刷新
            </button>
            <PermissionGuard permission="user:create">
              <button className="material-button-primary w-fit" onClick={openCreate}>
                <Plus className="h-4 w-4" />
                新建用户
              </button>
            </PermissionGuard>
          </div>
        </div>
      </section>

      {/* 数据表格 */}
      <section className="material-card p-6">
        {/* 筛选栏 */}
        <div className="mb-5 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div className="relative w-full max-w-sm">
            <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              className="material-input pl-11"
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              placeholder="搜索姓名、账号、角色、部门..."
            />
          </div>
          <FormControl size="small" sx={{ minWidth: 140 }}>
            <Select
              value={statusFilter}
              onChange={(e: SelectChangeEvent) =>
                setStatusFilter(e.target.value as "ALL" | UserStatus)
              }
            >
              <MenuItem value="ALL">全部状态</MenuItem>
              <MenuItem value="ACTIVE">启用</MenuItem>
              <MenuItem value="INVITED">待分配</MenuItem>
              <MenuItem value="DISABLED">停用</MenuItem>
            </Select>
          </FormControl>
        </div>

        {/* 表格 */}
        <div className="overflow-x-auto">
          <table className="min-w-full text-left">
            <thead className="bg-slate-50">
              <tr>
                {["姓名 / 账号", "角色", "部门", "状态", "密码", "操作"].map((col) => (
                  <th key={col} className="px-4 py-3 text-xs font-semibold uppercase tracking-[0.14em] text-slate-500 whitespace-nowrap">
                    {col}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                <tr>
                  <td colSpan={7} className="py-12 text-center text-sm text-slate-400">加载中...</td>
                </tr>
              ) : pagedUsers.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-12 text-center text-sm text-slate-400">暂无数据</td>
                </tr>
              ) : (
                pagedUsers.map((user) => (
                  <tr key={user.id} className="hover:bg-slate-50/70">
                    {/* 姓名 / 账号 */}
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1.5">
                        <span
                          className={cn(
                            "text-sm font-medium text-slate-800",
                            !isSuperAdmin(user) && "cursor-pointer hover:text-primary",
                          )}
                          onClick={() => { if (!isSuperAdmin(user)) openEdit(user); }}
                        >
                          {user.name}
                        </span>
                        {isSuperAdmin(user) && (
                          <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold text-amber-700">
                            超级
                          </span>
                        )}
                      </div>
                      {user.username && (
                        <div className="mt-0.5 text-xs text-slate-400">{user.username}</div>
                      )}
                    </td>
                    {/* 角色 */}
                    <td className="px-4 py-3 text-sm text-slate-700">{user.role?.name ?? "—"}</td>
                    {/* 部门 */}
                    <td className="px-4 py-3 text-sm text-slate-700">{user.department ?? "—"}</td>
                    {/* 状态 */}
                    <td className="px-4 py-3 text-sm">
                      <span
                        className={cn(
                          "material-chip",
                          user.status === "ACTIVE"
                            ? "bg-emerald-50 text-emerald-700"
                            : user.status === "DISABLED"
                              ? "bg-red-50 text-red-700"
                              : "bg-amber-50 text-amber-700",
                        )}
                      >
                        {STATUS_LABELS[user.status]}
                      </span>
                    </td>
                    {/* 密码 */}
                    <td className="px-4 py-3 text-sm">
                      <PasswordCell
                        user={user}
                        currentUserId={currentUserId}
                        currentUserIsSuperAdmin={currentUserIsSuperAdmin}
                        onChangePwd={openChangePwd}
                      />
                    </td>
                    {/* 操作 */}
                    <td className="px-4 py-3 text-sm">
                      {isSuperAdmin(user) ? (
                        <span className="text-xs text-slate-400">—</span>
                      ) : (
                        <div className="flex flex-wrap gap-2">
                          <PermissionGuard permission="user:edit">
                            <button
                              className="material-button-secondary !px-3 !py-2"
                              onClick={() => openEdit(user)}
                              title="编辑用户"
                            >
                              <Pencil className="h-3.5 w-3.5" />
                            </button>
                          </PermissionGuard>
                          <PermissionGuard permission="user:disable">
                            <button
                              className="material-button-secondary !px-3 !py-2"
                              onClick={() => void handleToggleStatus(user)}
                              title={user.status === "DISABLED" ? "启用" : "停用"}
                            >
                              {user.status === "DISABLED" ? (
                                <UserCheck className="h-3.5 w-3.5 text-emerald-600" />
                              ) : (
                                <UserX className="h-3.5 w-3.5 text-red-500" />
                              )}
                            </button>
                          </PermissionGuard>
                          <PermissionGuard permission="user:delete">
                            <button
                              className="material-button-secondary !px-3 !py-2 hover:border-red-200 hover:bg-red-50"
                              onClick={() => openDelete(user)}
                              title="删除用户"
                            >
                              <Trash2 className="h-3.5 w-3.5 text-red-500" />
                            </button>
                          </PermissionGuard>
                        </div>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* 分页 */}
        <div className="mt-5 flex items-center justify-between border-t border-slate-100 pt-4">
          <div className="text-sm text-slate-500">
            共 {filteredUsers.length} 条，第 {page} / {totalPages} 页
          </div>
          <div className="flex gap-2">
            <button
              className="material-button-secondary !px-3 !py-2"
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page === 1}
            >
              上一页
            </button>
            <button
              className="material-button-secondary !px-3 !py-2"
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page === totalPages}
            >
              下一页
            </button>
          </div>
        </div>
      </section>

      {/* 新建 / 编辑 弹窗 */}
      <Dialog
        open={dialogMode === "create" || dialogMode === "edit"}
        onClose={closeDialog}
        fullWidth
        maxWidth="sm"
      >
        <DialogTitle>{dialogMode === "edit" ? "编辑用户" : "新建用户"}</DialogTitle>
        <DialogContent dividers>
          <div className="space-y-4 pt-1">
            <div>
              <label className="mb-1.5 block text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
                姓名 <span className="text-red-500">*</span>
              </label>
              <input
                className="material-input w-full"
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="请输入姓名"
              />
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
                账号
              </label>
              <input
                className="material-input w-full"
                value={form.username}
                onChange={(e) => setForm((f) => ({ ...f, username: e.target.value }))}
                placeholder="登录账号（可选，默认使用邮箱登录）"
              />
            </div>
            {/* 密码仅新建时填写 */}
            {!form.id && (
              <div>
                <label className="mb-1.5 block text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
                  初始密码 <span className="text-red-500">*</span>
                </label>
                <div className="relative">
                  <input
                    className="material-input w-full pr-10"
                    type={showFormPwd ? "text" : "password"}
                    value={form.password}
                    onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
                    placeholder="至少 8 位"
                    autoComplete="new-password"
                  />
                  <button
                    type="button"
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                    onClick={() => setShowFormPwd((v) => !v)}
                    tabIndex={-1}
                  >
                    {showFormPwd ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>
            )}
            <div>
              <label className="mb-1.5 block text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
                部门
              </label>
              <FormControl size="small" fullWidth>
                <Select
                  value={form.department}
                  onChange={(e: SelectChangeEvent) =>
                    setForm((f) => ({ ...f, department: e.target.value }))
                  }
                  displayEmpty
                >
                  <MenuItem value="">— 暂不分配 —</MenuItem>
                  {departments.map((d) => (
                    <MenuItem key={d.id} value={d.label}>
                      {d.label}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
                角色
              </label>
              <FormControl size="small" fullWidth>
                <Select
                  value={form.roleId}
                  onChange={(e: SelectChangeEvent) =>
                    setForm((f) => ({ ...f, roleId: e.target.value }))
                  }
                  displayEmpty
                >
                  <MenuItem value="">— 暂不分配 —</MenuItem>
                  {assignableRoles.map((r) => (
                    <MenuItem key={r.id} value={r.id}>
                      {r.name}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
                状态
              </label>
              <FormControl size="small" fullWidth>
                <Select
                  value={form.status}
                  onChange={(e: SelectChangeEvent) =>
                    setForm((f) => ({ ...f, status: e.target.value as UserStatus }))
                  }
                >
                  <MenuItem value="ACTIVE">启用</MenuItem>
                  <MenuItem value="INVITED">待分配</MenuItem>
                  <MenuItem value="DISABLED">停用</MenuItem>
                </Select>
              </FormControl>
            </div>
          </div>
        </DialogContent>
        <DialogActions>
          <button className="material-button-secondary" onClick={closeDialog} disabled={saving}>
            取消
          </button>
          <button
            className="material-button-primary"
            onClick={() => void handleSaveUser()}
            disabled={saving}
          >
            {saving ? "保存中..." : "保存"}
          </button>
        </DialogActions>
      </Dialog>

      {/* 修改 / 重置密码弹窗 */}
      <Dialog open={dialogMode === "changePwd"} onClose={closeDialog} fullWidth maxWidth="xs">
        <DialogTitle>{changePwdTitle}</DialogTitle>
        <DialogContent dividers>
          {selectedUser && isSelf(selectedUser) && (
            <p className="mb-4 text-sm text-slate-500">修改后需重新登录方可生效。</p>
          )}
          {selectedUser && !isSelf(selectedUser) && (
            <p className="mb-4 text-sm text-slate-500">
              正在为 <strong>{selectedUser.name}</strong> 重置密码，重置后该用户需使用新密码登录。
            </p>
          )}
          <label className="mb-1.5 block text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
            新密码（至少 8 位）
          </label>
          <div className="relative">
            <input
              className="material-input w-full pr-10"
              type={showNewPwd ? "text" : "password"}
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              placeholder="请输入新密码"
              autoComplete="new-password"
            />
            <button
              type="button"
              className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
              onClick={() => setShowNewPwd((v) => !v)}
              tabIndex={-1}
            >
              {showNewPwd ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
        </DialogContent>
        <DialogActions>
          <button className="material-button-secondary" onClick={closeDialog} disabled={saving}>
            取消
          </button>
          <button
            className="material-button-primary"
            onClick={() => void handleChangePassword()}
            disabled={saving}
          >
            {saving ? "保存中..." : "确认"}
          </button>
        </DialogActions>
      </Dialog>

      {/* 删除确认弹窗 */}
      <Dialog open={dialogMode === "deleteConfirm"} onClose={closeDialog} fullWidth maxWidth="xs">
        <DialogTitle>确认删除用户</DialogTitle>
        <DialogContent dividers>
          <p className="text-sm text-slate-600">
            即将永久删除用户 <strong>{selectedUser?.name}</strong>，此操作无法撤销。
          </p>
        </DialogContent>
        <DialogActions>
          <button className="material-button-secondary" onClick={closeDialog} disabled={saving}>
            取消
          </button>
          <button
            className="rounded-xl bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-50"
            onClick={() => void handleDeleteUser()}
            disabled={saving}
          >
            {saving ? "删除中..." : "确认删除"}
          </button>
        </DialogActions>
      </Dialog>
    </div>
  );
}
