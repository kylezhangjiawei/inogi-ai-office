import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Eye,
  EyeOff,
  KeyRound,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  Trash2,
  UserCheck,
  Users,
  UserX,
} from "lucide-react";
import { toast } from "sonner";
import { authFetch } from "./lib/authSession";
import { subscribeDepartmentChanges } from "./lib/departmentDirectory";
import { useAuth } from "./auth";
import { cn } from "./components/ui/utils";
import { PermissionGuard } from "./components/PermissionGuard";
import { AutoTranslatedText } from "./components/TranslatableText";
import {
  HorizonEmptyState,
  HorizonMetric,
  HorizonMetricGrid,
  HorizonPageHeader,
  HorizonSectionHeader,
} from "./components/horizon/HorizonPage";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "./components/ui/alert-dialog";
import { Button } from "./components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "./components/ui/dialog";
import { Input } from "./components/ui/input";
import { Label } from "./components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./components/ui/select";
import { t as translate, useI18n } from "./lib/i18n";
import { PERMISSIONS } from "./lib/permissions";

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
  englishName: string;
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
  englishName: string;
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
  englishName: "",
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
const TABLE_HEADER_CLASS = "px-5 py-3 text-xs font-semibold text-slate-600 whitespace-nowrap";
const TABLE_CELL_CLASS = "px-5 py-4 align-middle text-sm text-slate-700";
const EMPTY_SELECT_VALUE = "__empty__";
const ALL_DEPARTMENTS = "ALL";
const UNASSIGNED_DEPARTMENT = "__unassigned__";
const SELECT_TRIGGER_CLASS = "h-10 rounded-xl border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700 outline-none transition-colors focus-visible:border-blue-300 focus-visible:ring-2 focus-visible:ring-blue-100";

function SelectControl({
  value,
  onValueChange,
  options,
  className,
  id,
  ariaLabel,
  ariaInvalid,
  ariaDescribedBy,
  required,
}: {
  value: string;
  onValueChange: (value: string) => void;
  options: Array<{ label: string; value: string }>;
  className?: string;
  id?: string;
  ariaLabel?: string;
  ariaInvalid?: boolean;
  ariaDescribedBy?: string;
  required?: boolean;
}) {
  const normalizedValue = value === "" ? EMPTY_SELECT_VALUE : value;

  return (
    <Select
      value={normalizedValue}
      onValueChange={(nextValue) => onValueChange(nextValue === EMPTY_SELECT_VALUE ? "" : nextValue)}
    >
      <SelectTrigger
        id={id}
        className={cn(SELECT_TRIGGER_CLASS, className)}
        aria-label={ariaLabel}
        aria-invalid={ariaInvalid || undefined}
        aria-describedby={ariaDescribedBy}
        aria-required={required || undefined}
      >
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
  if (!res.ok) throw new Error(translate("获取用户列表失败"));
  return res.json() as Promise<User[]>;
}

async function apiListRoles(): Promise<Role[]> {
  const res = await authFetch("/api/roles/options");
  if (!res.ok) throw new Error(translate("获取角色列表失败"));
  return res.json() as Promise<Role[]>;
}

async function apiListDepartments(): Promise<DepartmentOption[]> {
  const res = await authFetch("/api/departments/options");
  if (!res.ok) throw new Error(translate("获取部门列表失败"));
  return res.json() as Promise<DepartmentOption[]>;
}

async function apiSaveUser(payload: UserFormData): Promise<User> {
  const res = await authFetch("/api/users", {
    method: "POST",
    body: JSON.stringify({
      id: payload.id,
      name: payload.name,
      englishName: payload.englishName,
      username: payload.username || undefined,
      department: payload.department || undefined,
      roleId: payload.roleId || undefined,
      status: payload.status,
      password: !payload.id && payload.password ? payload.password : undefined,
    }),
  });
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { message?: string | string[] };
    const msg = Array.isArray(err.message) ? err.message.join(", ") : (err.message ?? translate("保存失败"));
    throw new Error(msg);
  }
  return res.json() as Promise<User>;
}

async function apiUpdateStatus(id: string, status: UserStatus): Promise<User> {
  const res = await authFetch(`/api/users/${id}/status`, {
    method: "PATCH",
    body: JSON.stringify({ status }),
  });
  if (!res.ok) throw new Error(translate("状态更新失败"));
  return res.json() as Promise<User>;
}

async function apiResetPassword(id: string, newPassword: string): Promise<void> {
  const res = await authFetch(`/api/users/${id}/reset-password`, {
    method: "POST",
    body: JSON.stringify({ newPassword }),
  });
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { message?: string };
    throw new Error(err.message ?? translate("密码修改失败"));
  }
}

async function apiDeleteUser(id: string): Promise<void> {
  const res = await authFetch(`/api/users/${id}`, { method: "DELETE" });
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { message?: string };
    throw new Error(err.message ?? translate("删除用户失败"));
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
  canResetOtherUsers,
  onChangePwd,
}: {
  user: User;
  currentUserId: string;
  canResetOtherUsers: boolean;
  onChangePwd: (user: User, trigger: HTMLButtonElement) => void;
}) {
  const isSelf = user.id === currentUserId;
  // 与后端契约一致：本人始终可修改（包括超管本人）；重置他人需要专项权限，
  // 且超级管理员账号不允许被其他人重置密码。
  const canChange = isSelf || (!isSuperAdmin(user) && canResetOtherUsers);

  return (
    <div className="flex min-w-0 items-center gap-2">
      <span className="shrink-0 font-mono text-xs text-slate-400" aria-hidden="true">••••••••</span>
      {canChange && (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={(event) => onChangePwd(user, event.currentTarget)}
          title={isSelf ? translate("修改我的密码") : translate("重置密码")}
          aria-label={isSelf ? translate("修改我的密码") : translate("重置 {name} 的密码", { name: user.name })}
        >
          <KeyRound className="size-4" aria-hidden="true" />
        </Button>
      )}
    </div>
  );
}

// ─── 主组件 ───────────────────────────────────────────────────────────────────

type DialogMode = "create" | "edit" | "changePwd" | "deleteConfirm" | null;
type UserFormErrors = Partial<Record<"name" | "password" | "department" | "roleId", string>>;

export function UserManagement() {
  const { t } = useI18n();
  const { user: currentUser } = useAuth();
  const currentUserId = currentUser?.id ?? "";
  const canResetOtherUsers = currentUser?.permissions.some(
    (permission) => permission === "*" || permission === PERMISSIONS.USER_RESET_PASSWORD,
  ) ?? false;

  const [users, setUsers] = useState<User[]>([]);
  const [roles, setRoles] = useState<Role[]>([]);
  const [departments, setDepartments] = useState<DepartmentOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [keyword, setKeyword] = useState("");
  const [departmentFilter, setDepartmentFilter] = useState(ALL_DEPARTMENTS);
  const [statusFilter, setStatusFilter] = useState<"ALL" | UserStatus>("ALL");
  const [page, setPage] = useState(1);

  const [dialogMode, setDialogMode] = useState<DialogMode>(null);
  const [selectedUser, setSelectedUser] = useState<User | null>(null);
  const [form, setForm] = useState<UserFormData>(EMPTY_FORM);
  const [showFormPwd, setShowFormPwd] = useState(false);
  const [newPassword, setNewPassword] = useState("");
  const [showNewPwd, setShowNewPwd] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formErrors, setFormErrors] = useState<UserFormErrors>({});
  const [newPasswordError, setNewPasswordError] = useState("");
  const [dialogError, setDialogError] = useState("");
  const dialogTriggerRef = useRef<HTMLButtonElement | null>(null);
  const pageFocusRef = useRef<HTMLButtonElement | null>(null);
  const nameInputRef = useRef<HTMLInputElement | null>(null);
  const passwordInputRef = useRef<HTMLInputElement | null>(null);
  const newPasswordInputRef = useRef<HTMLInputElement | null>(null);
  const loadRequestRef = useRef(0);

  const loadData = useCallback(async () => {
    const requestId = ++loadRequestRef.current;
    setLoading(true);
    setLoadError("");
    try {
      const [usersData, rolesData, typesData] = await Promise.all([
        apiListUsers(),
        apiListRoles(),
        apiListDepartments(),
      ]);
      if (requestId !== loadRequestRef.current) return;
      setUsers(usersData);
      setRoles(rolesData);
      setDepartments(typesData);
    } catch (err) {
      if (requestId !== loadRequestRef.current) return;
      const message = err instanceof Error ? err.message : t("数据加载失败");
      setLoadError(message);
      toast.error(message);
    } finally {
      if (requestId === loadRequestRef.current) setLoading(false);
    }
  }, [t]);

  useEffect(() => { void loadData(); }, [loadData]);
  useEffect(() => () => {
    loadRequestRef.current += 1;
  }, []);
  useEffect(
    () => subscribeDepartmentChanges(() => {
      void loadData();
    }),
    [loadData],
  );

  const departmentFilterOptions = useMemo(() => {
    const assignedDepartmentNames = users.flatMap((user) => (user.department ? [user.department] : []));
    return Array.from(new Set([...departments.map((department) => department.name), ...assignedDepartmentNames]));
  }, [departments, users]);

  const filteredUsers = useMemo(
    () =>
      users.filter((u) => {
        const q = keyword.toLowerCase();
        const matchKeyword =
          !keyword ||
          u.name.toLowerCase().includes(q) ||
          u.englishName.toLowerCase().includes(q) ||
          (u.username ?? "").toLowerCase().includes(q) ||
          (u.department ?? "").toLowerCase().includes(q) ||
          (u.role?.name ?? "").toLowerCase().includes(q);
        const matchDepartment =
          departmentFilter === ALL_DEPARTMENTS ||
          (departmentFilter === UNASSIGNED_DEPARTMENT ? !u.department : u.department === departmentFilter);
        const matchStatus = statusFilter === "ALL" || u.status === statusFilter;
        return matchKeyword && matchDepartment && matchStatus;
      }),
    [users, keyword, departmentFilter, statusFilter],
  );

  useEffect(() => { setPage(1); }, [keyword, departmentFilter, statusFilter]);

  const totalPages = Math.max(1, Math.ceil(filteredUsers.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const pagedUsers = filteredUsers.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);
  const activeCount = users.filter((user) => user.status === "ACTIVE").length;
  const disabledCount = users.filter((user) => user.status === "DISABLED").length;
  const assignedRoleCount = new Set(users.map((user) => user.roleId).filter(Boolean)).size;
  const hasActiveFilters = Boolean(keyword) || departmentFilter !== ALL_DEPARTMENTS || statusFilter !== "ALL";

  useEffect(() => {
    if (page !== safePage) setPage(safePage);
  }, [page, safePage]);

  // 可分配给用户的角色（排除超管角色）
  const assignableRoles = roles.filter((r) => !r.permissions?.includes("*"));

  function openCreate(trigger: HTMLButtonElement) {
    dialogTriggerRef.current = trigger;
    setSelectedUser(null);
    setForm(EMPTY_FORM);
    setShowFormPwd(false);
    setFormErrors({});
    setDialogError("");
    setDialogMode("create");
  }

  function openEdit(user: User, trigger: HTMLButtonElement) {
    dialogTriggerRef.current = trigger;
    setSelectedUser(user);
    setForm({
      id: user.id,
      name: user.name,
      englishName: user.englishName,
      username: user.username ?? "",
      department: user.department ?? "",
      roleId: user.roleId ?? "",
      status: user.status,
      password: "",
    });
    setShowFormPwd(false);
    setFormErrors({});
    setDialogError("");
    setDialogMode("edit");
  }

  function openChangePwd(user: User, trigger: HTMLButtonElement) {
    dialogTriggerRef.current = trigger;
    setSelectedUser(user);
    setNewPassword("");
    setShowNewPwd(false);
    setNewPasswordError("");
    setDialogError("");
    setDialogMode("changePwd");
  }

  function openDelete(user: User, trigger: HTMLButtonElement) {
    dialogTriggerRef.current = trigger;
    setSelectedUser(user);
    setDialogError("");
    setDialogMode("deleteConfirm");
  }

  function closeDialog() {
    setDialogMode(null);
    setSelectedUser(null);
    setFormErrors({});
    setNewPasswordError("");
    setDialogError("");
  }

  async function handleSaveUser() {
    const nextErrors: UserFormErrors = {};
    if (!form.name.trim()) nextErrors.name = t("请输入姓名");
    if (!form.id && !form.department.trim()) nextErrors.department = t("请选择部门");
    if (!form.id && !form.roleId) nextErrors.roleId = t("请选择角色");
    if (!form.id && !form.password.trim()) nextErrors.password = t("请输入初始密码");
    else if (!form.id && form.password.length < 8) nextErrors.password = t("密码长度至少 8 位");
    if (Object.keys(nextErrors).length > 0) {
      setFormErrors(nextErrors);
      requestAnimationFrame(() => {
        if (nextErrors.name) nameInputRef.current?.focus();
        else if (nextErrors.password) passwordInputRef.current?.focus();
        else if (nextErrors.department) document.getElementById("user-department")?.focus();
        else if (nextErrors.roleId) document.getElementById("user-role")?.focus();
      });
      return;
    }
    setDialogError("");
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
      void loadData();
      toast.success(form.id ? t("用户信息已更新") : t("用户已创建"));
      closeDialog();
    } catch (err) {
      const message = err instanceof Error ? err.message : t("保存失败");
      setDialogError(message);
      toast.error(message);
    } finally {
      setSaving(false);
    }
  }

  async function handleToggleStatus(user: User) {
    const newStatus: UserStatus = user.status === "DISABLED" ? "ACTIVE" : "DISABLED";
    try {
      const updated = await apiUpdateStatus(user.id, newStatus);
      setUsers((prev) => prev.map((u) => (u.id === updated.id ? updated : u)));
      void loadData();
      toast.success(newStatus === "ACTIVE" ? t("用户已启用") : t("用户已停用"));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("操作失败"));
    }
  }

  async function handleChangePassword() {
    if (!selectedUser) return;
    if (!newPassword.trim()) {
      setNewPasswordError(t("请输入新密码"));
      newPasswordInputRef.current?.focus();
      return;
    }
    if (newPassword.length < 8) {
      setNewPasswordError(t("密码长度至少 8 位"));
      newPasswordInputRef.current?.focus();
      return;
    }
    setNewPasswordError("");
    setDialogError("");
    setSaving(true);
    try {
      await apiResetPassword(selectedUser.id, newPassword);
      const isSelf = selectedUser.id === currentUserId;
      toast.success(isSelf ? t("密码已修改") : t("{name} 的密码已重置", { name: selectedUser.name }));
      closeDialog();
    } catch (err) {
      const message = err instanceof Error ? err.message : t("操作失败");
      setDialogError(message);
      toast.error(message);
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
      void loadData();
      toast.success(t("用户已删除"));
      closeDialog();
    } catch (err) {
      const message = err instanceof Error ? err.message : t("删除失败");
      setDialogError(message);
      toast.error(message);
    } finally {
      setSaving(false);
    }
  }

  const isSelf = (user: User) => user.id === currentUserId;
  const changePwdTitle = selectedUser
    ? isSelf(selectedUser)
      ? t("修改密码")
      : t("重置密码 · {name}", { name: selectedUser.name })
    : t("修改密码");

  return (
    <div className="horizon-theme hz-page">
      <div className="hz-page-inner space-y-3">
        <HorizonPageHeader
          Icon={Users}
          eyebrow="SYSTEM GOVERNANCE · IDENTITY"
          title={t("用户管理")}
          description={t("统一维护系统账号、角色分配、部门归属与启停状态，并为本人及授权管理员提供安全的密码操作入口。")}
          meta={(
            <>
              <span>{t("身份目录")}</span>
              <span aria-hidden="true">·</span>
              <span className="tabular-nums">{loading ? t("正在同步") : t("{count} 个账号", { count: users.length })}</span>
            </>
          )}
          actions={(
            <>
              <Button ref={pageFocusRef} type="button" variant="outline" onClick={() => void loadData()} disabled={loading}>
                <RefreshCw className="size-4" aria-hidden="true" />
                {loading ? t("读取中…") : t("刷新")}
              </Button>
              <PermissionGuard permission="user:create">
                <Button type="button" className="hz-primary-action" onClick={(event) => openCreate(event.currentTarget)}>
                  <Plus className="size-4" aria-hidden="true" />
                  {t("新建用户")}
                </Button>
              </PermissionGuard>
            </>
          )}
        />

        <HorizonMetricGrid className="!grid-cols-2 xl:!grid-cols-4">
          <HorizonMetric Icon={Users} label={t("用户总数")} value={loading && users.length === 0 ? "—" : users.length} note={t("当前身份目录账号")} tone="brand" />
          <HorizonMetric Icon={UserCheck} label={t("启用用户")} value={loading && users.length === 0 ? "—" : activeCount} note={t("可正常访问系统")} tone={activeCount > 0 ? "success" : "neutral"} />
          <HorizonMetric Icon={UserX} label={t("停用用户")} value={loading && users.length === 0 ? "—" : disabledCount} note={t("已暂停访问权限")} tone={disabledCount > 0 ? "warning" : "neutral"} />
          <HorizonMetric Icon={ShieldCheck} label={t("已用角色")} value={loading && users.length === 0 ? "—" : assignedRoleCount} note={t("已分配的角色种类")} tone="neutral" />
        </HorizonMetricGrid>

        <section className="hz-surface min-w-0 overflow-hidden" aria-label={t("用户目录工作台")}>
          <HorizonSectionHeader
            Icon={Users}
            title={t("用户目录")}
            description={t("按姓名、账号、角色、部门和状态检索，并在权限范围内维护账号。")}
            trailing={(
              <span className="text-xs text-slate-500">
                {t("显示")} <span className="tabular-nums font-semibold text-slate-700">{filteredUsers.length}</span> / {users.length} {t("条")}
              </span>
            )}
          />

          <div className="grid gap-3 border-b border-slate-200 p-4 md:grid-cols-[minmax(260px,1fr)_190px_160px_auto] md:items-end">
            <div className="min-w-0">
              <Label htmlFor="user-search" className="mb-1.5 block text-xs font-semibold text-slate-700">{t("搜索用户")}</Label>
              <div className="relative">
                <span className="pointer-events-none absolute inset-y-0 left-0 flex w-9 items-center justify-center text-slate-400" aria-hidden="true">
                  <Search className="size-4" />
                </span>
                <Input
                  id="user-search"
                  className="pl-9"
                  value={keyword}
                  onChange={(event) => setKeyword(event.target.value)}
                  placeholder={t("姓名、英文名、账号、角色或部门")}
                />
              </div>
            </div>
            <div>
              <Label htmlFor="user-department-filter" className="mb-1.5 block text-xs font-semibold text-slate-700">{t("部门")}</Label>
              <SelectControl
                id="user-department-filter"
                value={departmentFilter}
                onValueChange={setDepartmentFilter}
                options={[
                  { label: t("全部部门"), value: ALL_DEPARTMENTS },
                  ...departmentFilterOptions.map((department) => ({ label: t(department.trim()), value: department })),
                  { label: t("未分配部门"), value: UNASSIGNED_DEPARTMENT },
                ]}
                className="w-full"
                ariaLabel={t("按部门筛选用户")}
              />
            </div>
            <div>
              <Label htmlFor="user-status-filter" className="mb-1.5 block text-xs font-semibold text-slate-700">{t("状态")}</Label>
              <SelectControl
                id="user-status-filter"
                value={statusFilter}
                onValueChange={(value) => setStatusFilter(value as "ALL" | UserStatus)}
                options={[
                  { label: t("全部状态"), value: "ALL" },
                  { label: t("启用"), value: "ACTIVE" },
                  { label: t("待分配"), value: "INVITED" },
                  { label: t("停用"), value: "DISABLED" },
                ]}
                className="w-full"
                ariaLabel={t("按状态筛选用户")}
              />
            </div>
            <Button
              type="button"
              variant="outline"
              onClick={() => { setKeyword(""); setDepartmentFilter(ALL_DEPARTMENTS); setStatusFilter("ALL"); }}
              disabled={!hasActiveFilters}
            >
              {t("清除筛选")}
            </Button>
          </div>

          {loadError && users.length > 0 ? (
            <p role="alert" className="border-b border-amber-200 bg-amber-50 px-4 py-2.5 text-sm text-amber-800">{loadError}</p>
          ) : null}

          <div className="overflow-x-auto">
            <table className="w-full min-w-[1120px] table-fixed text-left">
              <caption className="sr-only">{t("用户姓名、角色、部门、状态、密码入口及可用操作")}</caption>
              <colgroup>
                <col className="w-[280px]" />
                <col className="w-[180px]" />
                <col className="w-[180px]" />
                <col className="w-[120px]" />
                <col className="w-[160px]" />
                <col className="w-[200px]" />
              </colgroup>
              <thead className="bg-slate-50/90">
                <tr>
                  {[t("姓名 / 英文名 / 账号"), t("角色"), t("部门"), t("状态"), t("密码"), t("操作")].map((column) => (
                    <th key={column} scope="col" className={cn(TABLE_HEADER_CLASS, column === t("操作") && "text-right")}>{column}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {loading && users.length === 0 ? (
                  Array.from({ length: 4 }, (_, index) => (
                    <tr key={index} aria-hidden="true">
                      <td colSpan={6} className="px-5 py-4"><div className="h-10 rounded-lg bg-slate-100" /></td>
                    </tr>
                  ))
                ) : pagedUsers.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="p-0">
                      <HorizonEmptyState
                        Icon={hasActiveFilters ? Search : Users}
                        title={hasActiveFilters ? t("没有匹配的用户") : loadError ? t("用户目录加载失败") : t("尚未建立用户目录")}
                        description={hasActiveFilters ? t("调整检索条件或清除筛选后重试。") : loadError ? loadError : t("新建首个用户，为其配置部门、角色和访问状态。")}
                        action={hasActiveFilters ? (
                          <Button type="button" variant="outline" onClick={() => { setKeyword(""); setDepartmentFilter(ALL_DEPARTMENTS); setStatusFilter("ALL"); }}>{t("清除筛选")}</Button>
                        ) : loadError ? (
                          <Button type="button" variant="outline" onClick={() => void loadData()}><RefreshCw className="size-4" aria-hidden="true" />{t("重新读取")}</Button>
                        ) : (
                          <PermissionGuard
                            permission="user:create"
                            fallback={<Button type="button" variant="outline" onClick={() => void loadData()}><RefreshCw className="size-4" aria-hidden="true" />{t("重新读取")}</Button>}
                          >
                            <Button type="button" className="hz-primary-action" onClick={(event) => openCreate(event.currentTarget)}><Plus className="size-4" aria-hidden="true" />{t("新建用户")}</Button>
                          </PermissionGuard>
                        )}
                      />
                    </td>
                  </tr>
                ) : (
                  pagedUsers.map((user) => (
                    <tr key={user.id} className="hover:bg-blue-50/35">
                      <td className={TABLE_CELL_CLASS}>
                        <div className="flex min-w-0 items-start gap-3">
                          <span className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-xl bg-blue-50 text-[#002fa7]" aria-hidden="true">
                            <Users className="size-[18px]" />
                          </span>
                          <div className="min-w-0">
                            <div className="flex min-w-0 items-center gap-2">
                              {isSuperAdmin(user) ? (
                                <span className="truncate font-semibold text-slate-800">{user.name}</span>
                              ) : (
                                <PermissionGuard permission="user:edit" fallback={<span className="truncate font-semibold text-slate-800">{user.name}</span>}>
                                  <button
                                    type="button"
                                    className="min-w-0 cursor-pointer truncate rounded-sm text-left font-semibold text-slate-800 hover:text-[#002fa7] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
                                    onClick={(event) => openEdit(user, event.currentTarget)}
                                  >
                                    {user.name}
                                  </button>
                                </PermissionGuard>
                              )}
                              {isSuperAdmin(user) ? <span className="shrink-0 rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-700">{t("超级管理员")}</span> : null}
                            </div>
                            <div className="mt-0.5 truncate text-xs font-medium text-slate-500">{user.englishName || "—"}</div>
                            <div className="mt-0.5 truncate text-xs text-slate-500">{user.username ? `@${user.username}` : user.email}</div>
                          </div>
                        </div>
                      </td>
                      <td className={TABLE_CELL_CLASS}>{user.role?.name ? <AutoTranslatedText as="div" className="truncate" text={t(user.role.name.trim())} /> : "—"}</td>
                      <td className={TABLE_CELL_CLASS}>{user.department ? <AutoTranslatedText as="div" className="truncate" text={t(user.department.trim())} /> : "—"}</td>
                      <td className={TABLE_CELL_CLASS}>
                        <span
                          className={cn(
                            "inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-semibold",
                            user.status === "ACTIVE"
                              ? "border-green-200 bg-green-50 text-green-700"
                              : user.status === "DISABLED"
                                ? "border-red-200 bg-red-50 text-red-700"
                                : "border-amber-200 bg-amber-50 text-amber-800",
                          )}
                        >
                          {t(STATUS_LABELS[user.status])}
                        </span>
                      </td>
                      <td className={TABLE_CELL_CLASS}>
                        <PasswordCell user={user} currentUserId={currentUserId} canResetOtherUsers={canResetOtherUsers} onChangePwd={openChangePwd} />
                      </td>
                      <td className={cn(TABLE_CELL_CLASS, "text-right")}>
                        {isSuperAdmin(user) ? (
                          <span className="text-xs text-slate-500">{t("受保护账号")}</span>
                        ) : (
                          <div className="flex justify-end gap-1">
                            <PermissionGuard permission="user:edit">
                              <Button type="button" variant="ghost" size="icon" onClick={(event) => openEdit(user, event.currentTarget)} aria-label={t("编辑用户 {name}", { name: user.name })} title={t("编辑用户")}>
                                <Pencil className="size-4" aria-hidden="true" />
                              </Button>
                            </PermissionGuard>
                            <PermissionGuard permission="user:disable">
                              <Button type="button" variant="ghost" size="icon" onClick={() => void handleToggleStatus(user)} aria-label={user.status === "DISABLED" ? t("启用用户 {name}", { name: user.name }) : t("停用用户 {name}", { name: user.name })} title={user.status === "DISABLED" ? t("启用") : t("停用")}>
                                {user.status === "DISABLED" ? <UserCheck className="size-4 text-green-600" aria-hidden="true" /> : <UserX className="size-4 text-amber-700" aria-hidden="true" />}
                              </Button>
                            </PermissionGuard>
                            <PermissionGuard permission="user:delete">
                              <Button type="button" variant="ghost" size="icon" className="text-red-600 hover:bg-red-50 hover:text-red-700" onClick={(event) => openDelete(user, event.currentTarget)} aria-label={t("删除用户 {name}", { name: user.name })} title={t("删除用户")}>
                                <Trash2 className="size-4" aria-hidden="true" />
                              </Button>
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

          <div className="flex flex-col gap-3 border-t border-slate-200 px-4 py-3 text-sm text-slate-500 sm:flex-row sm:items-center sm:justify-between">
            <div aria-live="polite">{t("共 {count} 条，第 {page} / {total} 页", { count: filteredUsers.length, page: safePage, total: totalPages })}</div>
            <div className="flex gap-2">
              <Button type="button" variant="outline" size="sm" onClick={() => setPage(Math.max(1, safePage - 1))} disabled={safePage === 1} aria-label={t("上一页")}>{t("上一页")}</Button>
              <Button type="button" variant="outline" size="sm" onClick={() => setPage(Math.min(totalPages, safePage + 1))} disabled={safePage === totalPages} aria-label={t("下一页")}>{t("下一页")}</Button>
            </div>
          </div>
        </section>
      </div>

      <Dialog open={dialogMode === "create" || dialogMode === "edit"} onOpenChange={(open) => { if (!open && !saving) closeDialog(); }}>
        <DialogContent
          className="horizon-portal max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-2xl"
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            const trigger = dialogTriggerRef.current;
            dialogTriggerRef.current = null;
            if (trigger?.isConnected) trigger.focus();
            else pageFocusRef.current?.focus();
          }}
        >
          <form onSubmit={(event) => { event.preventDefault(); void handleSaveUser(); }} className="space-y-5">
            <DialogHeader>
              <DialogTitle className="text-balance text-slate-900">{dialogMode === "edit" ? t("编辑用户") : t("新建用户")}</DialogTitle>
              <DialogDescription className="text-pretty">{t("维护账号身份、组织归属、角色与访问状态。")}</DialogDescription>
            </DialogHeader>

            {dialogError ? <p role="alert" className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{dialogError}</p> : null}

            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <Label htmlFor="user-name" className="mb-1.5 block text-sm font-semibold text-slate-700">{t("姓名")} <span className="text-red-600">*</span></Label>
                <Input
                  ref={nameInputRef}
                  id="user-name"
                  autoFocus
                  value={form.name}
                  onChange={(event) => { setForm((current) => ({ ...current, name: event.target.value })); if (formErrors.name) setFormErrors((current) => ({ ...current, name: undefined })); }}
                  placeholder={t("请输入姓名")}
                  aria-invalid={Boolean(formErrors.name)}
                  aria-describedby={formErrors.name ? "user-name-error" : undefined}
                />
                {formErrors.name ? <p id="user-name-error" role="alert" className="mt-1.5 text-xs font-medium text-red-600">{formErrors.name}</p> : null}
              </div>
              <div>
                <Label htmlFor="user-english-name" className="mb-1.5 block text-sm font-semibold text-slate-700">{t("英文名")}</Label>
                <Input id="user-english-name" value={form.englishName} maxLength={80} onChange={(event) => setForm((current) => ({ ...current, englishName: event.target.value }))} placeholder={t("可选，留空后系统自动生成")} />
                <p className="mt-1.5 text-pretty text-xs text-slate-500">{t("清空后保存将重新生成英文名。")}</p>
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <Label htmlFor="user-account" className="mb-1.5 block text-sm font-semibold text-slate-700">{t("账号")}</Label>
                <Input id="user-account" value={form.username} onChange={(event) => setForm((current) => ({ ...current, username: event.target.value }))} placeholder={t("可选，默认使用邮箱登录")} />
              </div>
              {!form.id ? (
                <div>
                  <Label htmlFor="user-initial-password" className="mb-1.5 block text-sm font-semibold text-slate-700">{t("初始密码")} <span className="text-red-600">*</span></Label>
                  <div className="relative">
                    <Input
                      ref={passwordInputRef}
                      id="user-initial-password"
                      className="pr-11"
                      type={showFormPwd ? "text" : "password"}
                      value={form.password}
                      onChange={(event) => { setForm((current) => ({ ...current, password: event.target.value })); if (formErrors.password) setFormErrors((current) => ({ ...current, password: undefined })); }}
                      placeholder={t("至少 8 位")}
                      autoComplete="new-password"
                      aria-invalid={Boolean(formErrors.password)}
                      aria-describedby={formErrors.password ? "user-initial-password-error" : undefined}
                    />
                    <span className="absolute inset-y-0 right-1 flex items-center">
                      <Button type="button" variant="ghost" size="icon" onClick={() => setShowFormPwd((value) => !value)} aria-label={showFormPwd ? t("隐藏初始密码") : t("显示初始密码")}>
                        {showFormPwd ? <EyeOff className="size-4" aria-hidden="true" /> : <Eye className="size-4" aria-hidden="true" />}
                      </Button>
                    </span>
                  </div>
                  {formErrors.password ? <p id="user-initial-password-error" role="alert" className="mt-1.5 text-xs font-medium text-red-600">{formErrors.password}</p> : null}
                </div>
              ) : null}
            </div>

            <div className="grid gap-4 sm:grid-cols-3">
              <div>
                <Label htmlFor="user-department" className="mb-1.5 block text-sm font-semibold text-slate-700">
                  {t("部门")} {!form.id ? <span className="text-red-600">*</span> : null}
                </Label>
                <SelectControl
                  id="user-department"
                  value={form.department}
                  onValueChange={(value) => {
                    setForm((current) => ({ ...current, department: value }));
                    if (formErrors.department) setFormErrors((current) => ({ ...current, department: undefined }));
                  }}
                  options={[
                    ...(!form.department
                      ? [{ label: t(form.id ? "当前未分配（保存时保持）" : "请选择部门（必填）"), value: "" }]
                      : []),
                    ...departments.map((department) => ({ label: t(department.name.trim()), value: department.name })),
                  ]}
                  className="w-full"
                  ariaLabel={t("选择用户部门")}
                  ariaInvalid={Boolean(formErrors.department)}
                  ariaDescribedBy={formErrors.department ? "user-department-error" : "user-department-help"}
                  required={!form.id}
                />
                {formErrors.department ? (
                  <p id="user-department-error" role="alert" className="mt-1.5 text-xs font-medium text-red-600">{formErrors.department}</p>
                ) : (
                  <p id="user-department-help" className="mt-1.5 text-pretty text-xs text-slate-500">
                    {t(form.id && !form.department ? "当前账号未分配部门；不选择将保持现状。" : form.id ? "只能更换为其他部门，不会清空当前归属。" : "新建账号必须归属一个部门。")}
                  </p>
                )}
              </div>
              <div>
                <Label htmlFor="user-role" className="mb-1.5 block text-sm font-semibold text-slate-700">
                  {t("角色")} {!form.id ? <span className="text-red-600">*</span> : null}
                </Label>
                <SelectControl
                  id="user-role"
                  value={form.roleId}
                  onValueChange={(value) => {
                    setForm((current) => ({ ...current, roleId: value }));
                    if (formErrors.roleId) setFormErrors((current) => ({ ...current, roleId: undefined }));
                  }}
                  options={[
                    ...(!form.roleId
                      ? [{ label: t(form.id ? "当前未分配（保存时保持）" : "请选择角色（必填）"), value: "" }]
                      : []),
                    ...assignableRoles.map((role) => ({ label: t(role.name.trim()), value: role.id })),
                  ]}
                  className="w-full"
                  ariaLabel={t("选择用户角色")}
                  ariaInvalid={Boolean(formErrors.roleId)}
                  ariaDescribedBy={formErrors.roleId ? "user-role-error" : "user-role-help"}
                  required={!form.id}
                />
                {formErrors.roleId ? (
                  <p id="user-role-error" role="alert" className="mt-1.5 text-xs font-medium text-red-600">{formErrors.roleId}</p>
                ) : (
                  <p id="user-role-help" className="mt-1.5 text-pretty text-xs text-slate-500">
                    {t(form.id && !form.roleId ? "当前账号未分配角色；不选择将保持现状。" : form.id ? "只能更换为其他角色，不会清空当前权限。" : "新建账号必须分配一个角色。")}
                  </p>
                )}
              </div>
              <div>
                <Label htmlFor="user-status" className="mb-1.5 block text-sm font-semibold text-slate-700">{t("状态")}</Label>
                <SelectControl id="user-status" value={form.status} onValueChange={(value) => setForm((current) => ({ ...current, status: value as UserStatus }))} options={[{ label: t("启用"), value: "ACTIVE" }, { label: t("待分配"), value: "INVITED" }, { label: t("停用"), value: "DISABLED" }]} className="w-full" ariaLabel={t("选择用户状态")} />
              </div>
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={closeDialog} disabled={saving}>{t("取消")}</Button>
              <Button type="submit" className="hz-primary-action" disabled={saving}>{saving ? t("保存中…") : t("保存用户")}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={dialogMode === "changePwd"} onOpenChange={(open) => { if (!open && !saving) closeDialog(); }}>
        <DialogContent
          className="horizon-portal sm:max-w-md"
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            const trigger = dialogTriggerRef.current;
            dialogTriggerRef.current = null;
            if (trigger?.isConnected) trigger.focus();
            else pageFocusRef.current?.focus();
          }}
        >
          <form onSubmit={(event) => { event.preventDefault(); void handleChangePassword(); }} className="space-y-5">
            <DialogHeader>
              <DialogTitle className="text-balance text-slate-900">{changePwdTitle}</DialogTitle>
              <DialogDescription className="text-pretty">
                {selectedUser && isSelf(selectedUser)
                  ? t("密码修改后需重新登录方可生效。")
                  : t("为 {name} 设置新密码，保存后该用户需使用新密码登录。", { name: selectedUser?.name ?? "" })}
              </DialogDescription>
            </DialogHeader>

            {dialogError ? <p role="alert" className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{dialogError}</p> : null}

            <div>
              <Label htmlFor="user-new-password" className="mb-1.5 block text-sm font-semibold text-slate-700">{t("新密码")} <span className="text-red-600">*</span></Label>
              <div className="relative">
                <Input
                  ref={newPasswordInputRef}
                  id="user-new-password"
                  autoFocus
                  className="pr-11"
                  type={showNewPwd ? "text" : "password"}
                  value={newPassword}
                  onChange={(event) => { setNewPassword(event.target.value); if (newPasswordError) setNewPasswordError(""); }}
                  placeholder={t("至少 8 位")}
                  autoComplete="new-password"
                  aria-invalid={Boolean(newPasswordError)}
                  aria-describedby={newPasswordError ? "user-new-password-error" : "user-new-password-help"}
                />
                <span className="absolute inset-y-0 right-1 flex items-center">
                  <Button type="button" variant="ghost" size="icon" onClick={() => setShowNewPwd((value) => !value)} aria-label={showNewPwd ? t("隐藏新密码") : t("显示新密码")}>
                    {showNewPwd ? <EyeOff className="size-4" aria-hidden="true" /> : <Eye className="size-4" aria-hidden="true" />}
                  </Button>
                </span>
              </div>
              {newPasswordError ? <p id="user-new-password-error" role="alert" className="mt-1.5 text-xs font-medium text-red-600">{newPasswordError}</p> : <p id="user-new-password-help" className="mt-1.5 text-xs text-slate-500">{t("密码长度至少 8 位。")}</p>}
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={closeDialog} disabled={saving}>{t("取消")}</Button>
              <Button type="submit" className="hz-primary-action" disabled={saving}>{saving ? t("保存中…") : t("确认修改")}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <AlertDialog open={dialogMode === "deleteConfirm"} onOpenChange={(open) => { if (!open && !saving) closeDialog(); }}>
        <AlertDialogContent
          className="horizon-portal sm:max-w-md"
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            const trigger = dialogTriggerRef.current;
            dialogTriggerRef.current = null;
            if (trigger?.isConnected) trigger.focus();
            else pageFocusRef.current?.focus();
          }}
        >
          <AlertDialogHeader>
            <AlertDialogTitle className="text-balance text-slate-900">{t("确认删除用户？")}</AlertDialogTitle>
            <AlertDialogDescription className="text-pretty leading-6">{t("即将永久删除用户 {name}，此操作无法撤销。", { name: selectedUser?.name ?? "" })}</AlertDialogDescription>
          </AlertDialogHeader>
          {dialogError ? <p role="alert" className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{dialogError}</p> : null}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={saving}>{t("保留用户")}</AlertDialogCancel>
            <AlertDialogAction className="bg-red-600 text-white hover:bg-red-700 focus:ring-red-600" disabled={saving} onClick={(event) => { event.preventDefault(); void handleDeleteUser(); }}>
              {saving ? t("删除中…") : t("确认删除")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
