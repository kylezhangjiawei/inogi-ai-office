import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Eye, EyeOff, KeyRound, Pencil, Plus, RefreshCw, Search, Trash2, UserCheck, UserX } from "lucide-react";
import { toast } from "sonner";
import { authFetch } from "./lib/authSession";
import { useAuth } from "./auth";
import { cn } from "./components/ui/utils";
import { PermissionGuard } from "./components/PermissionGuard";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./components/ui/select";

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

type DepartmentOption = {
  id: string;
  name: string;
  code: string;
  category: string;
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
const TABLE_HEADER_CLASS = "px-5 py-3 text-xs font-semibold uppercase tracking-[0.14em] text-slate-500 whitespace-nowrap";
const TABLE_CELL_CLASS = "px-5 py-4 align-middle text-sm text-slate-700";
const EMPTY_SELECT_VALUE = "__empty__";
const SELECT_TRIGGER_CLASS = "h-10 rounded-xl border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700 shadow-sm outline-none transition focus-visible:border-blue-300 focus-visible:ring-2 focus-visible:ring-blue-100";

function ActionIconButton({
  children,
  className,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { children: React.ReactNode }) {
  return (
    <button
      className={cn(
        "inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-600 shadow-sm transition hover:border-blue-200 hover:bg-blue-50 hover:text-blue-700 disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
}

function ModalShell({
  title,
  children,
  footer,
  maxWidth = "max-w-lg",
}: {
  title: React.ReactNode;
  children: React.ReactNode;
  footer: React.ReactNode;
  maxWidth?: string;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/35 p-4" role="dialog" aria-modal="true">
      <div className={cn("w-full overflow-hidden rounded-2xl bg-white shadow-2xl ring-1 ring-slate-200", maxWidth)}>
        <div className="px-6 py-4 text-base font-bold text-slate-900">{title}</div>
        <div className="max-h-[70vh] overflow-y-auto border-y border-slate-100 px-6 py-5">{children}</div>
        <div className="flex justify-end gap-2 px-6 py-4">{footer}</div>
      </div>
    </div>
  );
}

function SelectControl({
  value,
  onValueChange,
  options,
  className,
}: {
  value: string;
  onValueChange: (value: string) => void;
  options: Array<{ label: string; value: string }>;
  className?: string;
}) {
  const normalizedValue = value === "" ? EMPTY_SELECT_VALUE : value;

  return (
    <Select
      value={normalizedValue}
      onValueChange={(nextValue) => onValueChange(nextValue === EMPTY_SELECT_VALUE ? "" : nextValue)}
    >
      <SelectTrigger className={cn(SELECT_TRIGGER_CLASS, className)}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent className="rounded-xl border border-slate-200 bg-white p-1 shadow-lg">
        {options.map((option) => (
          <SelectItem
            key={option.value || EMPTY_SELECT_VALUE}
            value={option.value === "" ? EMPTY_SELECT_VALUE : option.value}
            className="rounded-lg py-2 pl-3 pr-9 text-sm text-slate-700"
          >
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

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

async function apiListDepartments(): Promise<DepartmentOption[]> {
  const res = await authFetch("/api/departments/options");
  if (!res.ok) throw new Error("获取部门列表失败");
  return res.json() as Promise<DepartmentOption[]>;
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
    <div className="flex min-w-0 items-center gap-2">
      <span className="shrink-0 font-mono text-xs tracking-widest text-slate-400">••••••••</span>
      {canChange && (
        <ActionIconButton
          onClick={() => onChangePwd(user)}
          title={isSelf ? "修改我的密码" : "重置密码"}
        >
          <KeyRound className="h-3.5 w-3.5" />
        </ActionIconButton>
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
  const [departments, setDepartments] = useState<DepartmentOption[]>([]);
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
        apiListDepartments(),
      ]);
      setUsers(usersData);
      setRoles(rolesData);
      setDepartments(typesData);
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
  const activeCount = users.filter((user) => user.status === "ACTIVE").length;
  const disabledCount = users.filter((user) => user.status === "DISABLED").length;
  const assignedRoleCount = new Set(users.map((user) => user.roleId).filter(Boolean)).size;

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

      <section className="grid gap-4 md:grid-cols-4">
        {[
          ["用户总数", users.length],
          ["启用用户", activeCount],
          ["停用用户", disabledCount],
          ["已分配角色", assignedRoleCount],
        ].map(([label, value]) => (
          <div key={label} className="material-card p-5">
            <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">{label}</div>
            <div className="mt-3 text-3xl font-bold text-slate-900">{value}</div>
          </div>
        ))}
      </section>

      {/* 数据表格 */}
      <section className="material-card p-5 md:p-6">
        {/* 筛选栏 */}
        <div className="mb-4 flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
          <div className="relative w-full xl:max-w-[420px]">
            <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              className="material-input pl-11"
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              placeholder="搜索姓名、账号、角色、部门..."
            />
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <SelectControl
              value={statusFilter}
              onValueChange={(value) => setStatusFilter(value as "ALL" | UserStatus)}
              options={[
                { label: "全部状态", value: "ALL" },
                { label: "启用", value: "ACTIVE" },
                { label: "待分配", value: "INVITED" },
                { label: "停用", value: "DISABLED" },
              ]}
              className="min-w-[150px]"
            />
          </div>
        </div>

        {/* 表格 */}
        <div className="overflow-hidden rounded-2xl border border-slate-200">
          <div className="overflow-x-auto">
          <table className="w-full min-w-[1120px] table-fixed text-left">
            <colgroup>
              <col className="w-[260px]" />
              <col className="w-[180px]" />
              <col className="w-[180px]" />
              <col className="w-[120px]" />
              <col className="w-[170px]" />
              <col className="w-[210px]" />
            </colgroup>
            <thead className="bg-slate-50/90">
              <tr>
                {["姓名 / 账号", "角色", "部门", "状态", "密码", "操作"].map((col) => (
                  <th key={col} className={cn(TABLE_HEADER_CLASS, col === "操作" && "text-right")}>
                    {col}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                <tr>
                  <td colSpan={6} className="py-12 text-center text-sm text-slate-400">加载中...</td>
                </tr>
              ) : pagedUsers.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-12 text-center text-sm text-slate-400">暂无数据</td>
                </tr>
              ) : (
                pagedUsers.map((user) => (
                  <tr key={user.id} className="h-[76px] transition hover:bg-blue-50/25">
                    {/* 姓名 / 账号 */}
                    <td className={TABLE_CELL_CLASS}>
                      <div className="flex min-w-0 items-center gap-1.5">
                        <span
                          className={cn(
                            "min-w-0 truncate text-sm font-medium text-slate-800",
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
                        <div className="mt-0.5 truncate text-xs text-slate-400">{user.username}</div>
                      )}
                    </td>
                    {/* 角色 */}
                    <td className={TABLE_CELL_CLASS}>
                      <div className="truncate">{user.role?.name ?? "—"}</div>
                    </td>
                    {/* 部门 */}
                    <td className={TABLE_CELL_CLASS}>
                      <div className="truncate">{user.department ?? "—"}</div>
                    </td>
                    {/* 状态 */}
                    <td className={TABLE_CELL_CLASS}>
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
                    <td className={TABLE_CELL_CLASS}>
                      <PasswordCell
                        user={user}
                        currentUserId={currentUserId}
                        currentUserIsSuperAdmin={currentUserIsSuperAdmin}
                        onChangePwd={openChangePwd}
                      />
                    </td>
                    {/* 操作 */}
                    <td className={cn(TABLE_CELL_CLASS, "text-right")}>
                      {isSuperAdmin(user) ? (
                        <span className="text-xs text-slate-400">不可操作</span>
                      ) : (
                        <div className="flex justify-end gap-2">
                          <PermissionGuard permission="user:edit">
                            <ActionIconButton
                              onClick={() => openEdit(user)}
                              title="编辑用户"
                            >
                              <Pencil className="h-3.5 w-3.5" />
                            </ActionIconButton>
                          </PermissionGuard>
                          <PermissionGuard permission="user:disable">
                            <ActionIconButton
                              onClick={() => void handleToggleStatus(user)}
                              title={user.status === "DISABLED" ? "启用" : "停用"}
                            >
                              {user.status === "DISABLED" ? (
                                <UserCheck className="h-3.5 w-3.5 text-emerald-600" />
                              ) : (
                                <UserX className="h-3.5 w-3.5 text-red-500" />
                              )}
                            </ActionIconButton>
                          </PermissionGuard>
                          <PermissionGuard permission="user:delete">
                            <ActionIconButton
                              className="hover:border-red-200 hover:bg-red-50"
                              onClick={() => openDelete(user)}
                              title="删除用户"
                            >
                              <Trash2 className="h-3.5 w-3.5 text-red-500" />
                            </ActionIconButton>
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
        </div>

        {/* 分页 */}
        <div className="mt-5 flex flex-col gap-3 border-t border-slate-100 pt-4 sm:flex-row sm:items-center sm:justify-between">
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
      {(dialogMode === "create" || dialogMode === "edit") && (
      <ModalShell
        title={dialogMode === "edit" ? "编辑用户" : "新建用户"}
        maxWidth="max-w-xl"
        footer={
          <>
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
          </>
        }
      >
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
              <SelectControl
                value={form.department}
                onValueChange={(value) => setForm((f) => ({ ...f, department: value }))}
                options={[
                  { label: "— 暂不分配 —", value: "" },
                  ...departments.map((department) => ({ label: department.name, value: department.name })),
                ]}
                className="w-full"
              />
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
                角色
              </label>
              <SelectControl
                value={form.roleId}
                onValueChange={(value) => setForm((f) => ({ ...f, roleId: value }))}
                options={[
                  { label: "— 暂不分配 —", value: "" },
                  ...assignableRoles.map((role) => ({ label: role.name, value: role.id })),
                ]}
                className="w-full"
              />
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
                状态
              </label>
              <SelectControl
                value={form.status}
                onValueChange={(value) => setForm((f) => ({ ...f, status: value as UserStatus }))}
                options={[
                  { label: "启用", value: "ACTIVE" },
                  { label: "待分配", value: "INVITED" },
                  { label: "停用", value: "DISABLED" },
                ]}
                className="w-full"
              />
            </div>
          </div>
      </ModalShell>
      )}

      {/* 修改 / 重置密码弹窗 */}
      {dialogMode === "changePwd" && (
      <ModalShell
        title={changePwdTitle}
        maxWidth="max-w-md"
        footer={
          <>
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
          </>
        }
      >
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
      </ModalShell>
      )}

      {/* 删除确认弹窗 */}
      {dialogMode === "deleteConfirm" && (
      <ModalShell
        title="确认删除用户"
        maxWidth="max-w-md"
        footer={
          <>
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
          </>
        }
      >
          <p className="text-sm text-slate-600">
            即将永久删除用户 <strong>{selectedUser?.name}</strong>，此操作无法撤销。
          </p>
      </ModalShell>
      )}
    </div>
  );
}
