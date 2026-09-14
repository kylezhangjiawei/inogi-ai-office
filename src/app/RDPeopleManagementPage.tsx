import React, { useDeferredValue, useEffect, useId, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  AlertTriangle,
  ArrowRight,
  ChevronLeft,
  ChevronRight,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  Trash2,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "./components/ui/badge";
import { Button } from "./components/ui/button";
import { Input } from "./components/ui/input";
import { NativeSelect } from "./components/ui/native-select";
import { Slider } from "./components/ui/slider";
import { cn } from "./components/ui/utils";
import { usePermission } from "./hooks/usePermission";

import { PERMISSIONS } from "./lib/permissions";
import {
  createRdPerson,
  deleteRdPerson,
  fetchRdPeople,
  fetchRdPeopleUserOptions,
  updateRdPerson,
  type RdIdentityUser,
  type RdPersonLoad,
  type RdPersonMutation,
} from "./lib/rdApi";
import { authFetch } from "./lib/authSession";
import { t, useI18n } from "./lib/i18n";

// ─── Department API（复用 /api/departments，独立于 RD API 前缀） ──────────────

type DepartmentOption = { id: string; code: string; name: string; category: string };

async function apiListDepartmentOptions(): Promise<DepartmentOption[]> {
  const res = await authFetch("/api/departments/options");
  if (!res.ok) throw new Error(t("获取分组列表失败"));
  return res.json() as Promise<DepartmentOption[]>;
}

async function apiCreateDepartment(name: string): Promise<DepartmentOption> {
  // 兜底自动生成 code/category，避免要求管理员填一堆字段
  const code = `RD-${Date.now().toString(36).toUpperCase()}`;
  const res = await authFetch("/api/departments", {
    method: "POST",
    body: JSON.stringify({
      name: name.trim(),
      code,
      category: "研发",
      enabled: true,
    }),
  });
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { message?: string | string[] };
    const msg = Array.isArray(err.message) ? err.message.join(", ") : (err.message ?? t("新建分组失败"));
    throw new Error(msg);
  }
  return res.json() as Promise<DepartmentOption>;
}

// ─── Types ───────────────────────────────────────────────────────────────────

export type PersonStatus = "active" | "on_leave" | "resigned";

export type Person = {
  id: string;
  user_id?: string | null;
  name: string;
  position: string;
  department: string;
  email?: string;
  username?: string | null;
  user_status?: string | null;
  phone?: string;
  status: PersonStatus;
  max_tasks: number;
  task_count?: number;
  tasks?: string[];
  task_ids?: string[];
  blocked_count?: number;
  completed_this_month?: number;
  avg_completion?: number;
  joined_at?: string;
  /** 知识库访问分值：0（完全公开）~ 100（最高权限）。成员分值 >= 文件分值时可查看。 */
  kb_level?: number;
  kb_level_scale?: "score";
};

const INITIAL_PEOPLE: Person[] = [];

const PERSON_STATUS_CONFIG: Record<
  PersonStatus,
  { label: string; dot: string; text: string; bg: string }
> = {
  active: { label: "在岗", dot: "bg-emerald-500", text: "text-emerald-700", bg: "bg-emerald-50" },
  on_leave: { label: "请假中", dot: "bg-amber-500", text: "text-amber-700", bg: "bg-amber-50" },
  resigned: { label: "已离职", dot: "bg-slate-400", text: "text-slate-500", bg: "bg-slate-100" },
};

const PEOPLE_PAGE_SIZE = 5;

export type RDPeopleVisualVariant = "default" | "rd-horizon";

const DIALOG_FOCUSABLE_SELECTOR = [
  "button:not([disabled])",
  "[href]",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

function useDialogFocus(onClose: () => void, lockPage: boolean) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);

  useEffect(() => {
    closeRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return undefined;

    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const appRoot = document.getElementById("root");
    const rootWasInert = appRoot?.hasAttribute("inert") ?? false;
    const previousBodyOverflow = document.body.style.overflow;

    if (lockPage) {
      appRoot?.setAttribute("inert", "");
      document.body.style.overflow = "hidden";
    }

    const focusFirstControl = window.requestAnimationFrame(() => {
      const initialTarget = dialog.querySelector<HTMLElement>("[data-autofocus]")
        ?? dialog.querySelector<HTMLElement>(DIALOG_FOCUSABLE_SELECTOR);
      initialTarget?.focus();
    });

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeRef.current();
        return;
      }
      if (event.key !== "Tab") return;

      const controls = Array.from(dialog.querySelectorAll<HTMLElement>(DIALOG_FOCUSABLE_SELECTOR))
        .filter((element) => element.getClientRects().length > 0 && !element.hasAttribute("disabled"));
      if (controls.length === 0) {
        event.preventDefault();
        dialog.focus();
        return;
      }

      const first = controls[0];
      const last = controls[controls.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      window.cancelAnimationFrame(focusFirstControl);
      document.removeEventListener("keydown", handleKeyDown);
      if (lockPage) {
        if (!rootWasInert) appRoot?.removeAttribute("inert");
        document.body.style.overflow = previousBodyOverflow;
      }
      if (opener?.isConnected) opener.focus();
    };
  }, [lockPage]);

  return dialogRef;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function hashColor(name: string): string {
  const colors = [
    "bg-[#002fa7]",
    "bg-slate-600",
    "bg-[#1747b8]",
  ];
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return colors[h % colors.length];
}

function clampAccessScore(value: unknown): number {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 20;
  return Math.max(0, Math.min(100, Math.round(numeric)));
}

function getAccessScoreConfig(score: number) {
  if (score <= 25) {
    return {
      label: "公开",
      badgeClass: "border-emerald-200 bg-emerald-50 text-emerald-700",
      sliderClass: "[&_[data-slot=slider-range]]:bg-emerald-500",
      hint: "仅查看公开资料",
    };
  }
  if (score <= 50) {
    return {
      label: "内部",
      badgeClass: "border-[#cbd8f6] bg-[#eef3ff] text-[#002fa7]",
      sliderClass: "[&_[data-slot=slider-range]]:bg-[#002fa7]",
      hint: "可查看常规研发资料",
    };
  }
  if (score <= 75) {
    return {
      label: "受限",
      badgeClass: "border-amber-200 bg-amber-50 text-amber-700",
      sliderClass: "[&_[data-slot=slider-range]]:bg-amber-500",
      hint: "可查看受限项目资料",
    };
  }
  return {
    label: "机密",
    badgeClass: "border-rose-200 bg-rose-50 text-rose-700",
    sliderClass: "[&_[data-slot=slider-range]]:bg-rose-500",
    hint: "最高权限，可查看全部资料",
  };
}

function PersonAvatar({ name }: { name: string }) {
  const initial = name.replace(/\(.+?\)/g, "").trim().slice(0, 1) || "?";
  return (
    <span
      className={cn(
        "rd-people-avatar inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold text-white ring-2 ring-white",
        hashColor(name),
      )}
      title={name}
    >
      {initial}
    </span>
  );
}

function emptyPerson(): Person {
  return {
    id: "",
    user_id: null,
    name: "",
    position: "",
    department: "硬件组",
    email: "",
    phone: "",
    status: "active",
    max_tasks: 8,
    task_count: 0,
    tasks: [],
    kb_level: 20,
    kb_level_scale: "score",
  };
}

function personFromLoad(person: RdPersonLoad): Person {
  const status: PersonStatus =
    person.status === "resigned" || person.status === "on_leave" || person.status === "active"
      ? person.status
      : person.on_leave
        ? "on_leave"
        : "active";
  return {
    id: person.id,
    user_id: person.user_id ?? null,
    name: person.name,
    position: person.position,
    department: person.department ?? "",
    email: person.email,
    username: person.username ?? null,
    user_status: person.user_status ?? null,
    phone: person.phone,
    status,
    max_tasks: person.max_tasks,
    task_count: person.task_count,
    tasks: person.tasks,
    task_ids: person.task_ids,
    blocked_count: person.blocked_count,
    completed_this_month: person.completed_this_month,
    avg_completion: person.avg_completion,
    joined_at: person.joined_at,
    kb_level: typeof person.kb_level === "number" ? person.kb_level : undefined,
    kb_level_scale: person.kb_level_scale === "score" ? "score" : undefined,
  };
}

function personToMutation(person: Person): RdPersonMutation {
  return {
    id: person.id || undefined,
    user_id: person.user_id,
    name: person.name,
    position: person.position,
    department: person.department,
    email: person.email,
    username: person.username,
    user_status: person.user_status,
    phone: person.phone,
    status: person.status,
    max_tasks: person.max_tasks,
    joined_at: person.joined_at,
    kb_level: person.kb_level,
    kb_level_scale: person.kb_level_scale,
  };
}

// ─── Form Field wrapper ──────────────────────────────────────────────────────

function Field({
  label,
  required,
  error,
  group,
  children,
}: {
  label: string;
  required?: boolean;
  error?: string;
  group?: boolean;
  children: React.ReactNode;
}) {
  const content = (
    <>
      <div className="mb-1.5 flex items-baseline gap-1 text-xs font-medium text-slate-700">
        {label}
        {required && <span className="text-rose-500">*</span>}
        {error && <span className="ml-auto text-[11px] font-normal text-rose-600">{error}</span>}
      </div>
      {children}
    </>
  );

  if (group) {
    return (
      <div className="block" role="group" aria-label={label}>
        {content}
      </div>
    );
  }

  return (
    <label className="block">
      {content}
    </label>
  );
}

// ─── Form modal ──────────────────────────────────────────────────────────────

function PersonFormModal({
  person,
  users,
  identityOptionsError,
  onRetryIdentityOptions,
  canManageDepartments,
  visualVariant,
  saving,
  onSave,
  onClose,
}: {
  person: Person | null;
  users: RdIdentityUser[];
  identityOptionsError: string | null;
  onRetryIdentityOptions: () => void;
  canManageDepartments: boolean;
  visualVariant: RDPeopleVisualVariant;
  saving: boolean;
  onSave: (p: Person) => Promise<void>;
  onClose: () => void;
}) {
  useI18n();
  const isEdit = person !== null;
  const isHorizon = visualVariant === "rd-horizon";
  const titleId = useId();
  const descriptionId = useId();
  const [form, setForm] = useState<Person>(person ?? emptyPerson());
  const [errors, setErrors] = useState<{ name?: string; position?: string }>({});
  // 切换编辑对象 / 重新打开同一个对象时，把表单 state 同步到最新 person prop，避免显示老数据
  useEffect(() => {
    setForm(person ?? emptyPerson());
    setErrors({});
  }, [person?.id]);

  // 分组选项统一来自部门主数据；编辑旧记录时只额外保留该记录当前值。
  const [departments, setDepartments] = useState<string[]>([]);
  const [departmentError, setDepartmentError] = useState<string | null>(null);
  const [departmentReloadVersion, setDepartmentReloadVersion] = useState(0);
  const [creatingDept, setCreatingDept] = useState(false);
  const [newDeptName, setNewDeptName] = useState("");
  const [savingNewDept, setSavingNewDept] = useState(false);
  const closeModal = () => {
    if (!saving && !savingNewDept) onClose();
  };
  const dialogRef = useDialogFocus(closeModal, isHorizon);

  useEffect(() => {
    let cancelled = false;
    setDepartmentError(null);
    apiListDepartmentOptions()
      .then((list) => {
        if (cancelled) return;
        const names = list.map((d) => d.name).filter(Boolean);
        // 确保至少含有当前 form.department，避免编辑时下拉里没有当前值
        const merged = Array.from(new Set([...names, ...(form.department ? [form.department] : [])]));
        setDepartments(merged);
        setDepartmentError(null);
      })
      .catch((error) => {
        if (!cancelled) {
          setDepartments(form.department ? [form.department] : []);
          setDepartmentError(error instanceof Error ? error.message : t("获取分组列表失败"));
        }
      });
    return () => { cancelled = true; };
    // 故意只在挂载时拉一次；新建后会手动 push 到 departments
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [departmentReloadVersion]);

  const handleCreateDepartment = async () => {
    if (savingNewDept) return;
    const name = newDeptName.trim();
    if (!name) {
      toast.error(t("分组名称不能为空"));
      return;
    }
    if (departments.includes(name)) {
      toast.error(t("该分组已存在"));
      return;
    }
    setSavingNewDept(true);
    try {
      const created = await apiCreateDepartment(name);
      setDepartments((prev) => Array.from(new Set([...prev, created.name])));
      setForm((f) => ({ ...f, department: created.name }));
      toast.success(t("已新建分组：{name}", { name: created.name }));
      setCreatingDept(false);
      setNewDeptName("");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("新建分组失败"));
    } finally {
      setSavingNewDept(false);
    }
  };

  const userById = useMemo(() => new Map(users.map((user) => [user.id, user])), [users]);
  const selectedUser = form.user_id ? userById.get(form.user_id) : undefined;
  const kbScore = clampAccessScore(form.kb_level);
  const kbScoreConfig = getAccessScoreConfig(kbScore);
  const dependenciesReady = !identityOptionsError && !departmentError;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (saving) return;
    if (!dependenciesReady) {
      toast.error(t("身份或分组主数据尚未读取成功，请重试后再保存"));
      return;
    }
    const newErrors: typeof errors = {};
    if (!form.name.trim()) newErrors.name = t("姓名不能为空");
    if (!form.position.trim()) newErrors.position = t("职位不能为空");
    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors);
      return;
    }
    await onSave({ ...form, kb_level: kbScore, kb_level_scale: "score" });
  };

  const dialog = (
    <div
      className={cn(
        "fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 px-4",
        isHorizon && "rd-horizon-people-dialog-overlay",
      )}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        tabIndex={-1}
        className={cn(
          "w-full max-w-md overflow-hidden rounded-2xl bg-white shadow-[0_24px_60px_rgba(15,23,42,0.2)]",
          isHorizon && "rd-horizon-people-dialog rd-horizon-people-form-dialog",
        )}
      >
        <header className="rd-people-dialog-header flex items-center justify-between border-b border-slate-100 px-6 py-4">
          <div>
            <h3 id={titleId} className="text-balance text-base font-semibold text-slate-900">
              {isEdit ? t("编辑成员") : t("新增成员")}
            </h3>
            <p id={descriptionId} className="mt-0.5 text-pretty text-xs text-slate-500">
              {isEdit ? t("修改 {name} 的信息", { name: person!.name }) : t("创建一个新的团队成员")}
            </p>
          </div>
          <button
            onClick={closeModal}
            disabled={saving || savingNewDept}
            type="button"
            className="rounded-md p-1.5 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#002fa7] disabled:cursor-not-allowed disabled:opacity-50"
            aria-label={t("关闭")}
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        <form onSubmit={handleSubmit} className="rd-people-dialog-form space-y-4 px-6 py-5">
          {identityOptionsError ? (
            <div role="alert" className="flex items-center justify-between gap-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
              <span className="min-w-0 text-pretty">{t("登录用户列表读取失败，当前禁止保存身份关联。")}</span>
              <Button type="button" variant="outline" size="sm" onClick={onRetryIdentityOptions} className="shrink-0">{t("重试")}</Button>
            </div>
          ) : null}
          {departmentError ? (
            <div role="alert" className="flex items-center justify-between gap-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
              <span className="min-w-0 text-pretty">{t("分组主数据读取失败，当前禁止保存组织归属。")}</span>
              <Button type="button" variant="outline" size="sm" onClick={() => setDepartmentReloadVersion((value) => value + 1)} className="shrink-0">{t("重试")}</Button>
            </div>
          ) : null}
          <Field label={t("绑定登录用户")}>
            <NativeSelect
              value={form.user_id ?? ""}
              disabled={saving || Boolean(identityOptionsError)}
              onChange={(e) => {
                const user = userById.get(e.target.value);
                setForm((current) => ({
                  ...current,
                  user_id: user?.id ?? null,
                  name: user?.name ?? current.name,
                  email: user?.email ?? current.email,
                  department: user?.department ?? current.department,
                  username: user?.username ?? current.username ?? null,
                  user_status: user?.status ?? current.user_status ?? null,
                }));
              }}
              className="w-full cursor-pointer rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none transition-colors focus:border-[#8fa9e8] focus:ring-2 focus:ring-[#dce5fa]"
            >
              <option value="">{t("未绑定登录用户")}</option>
              {users.map((user) => (
                <option key={user.id} value={user.id}>
                  {user.name} · {user.email}
                </option>
              ))}
            </NativeSelect>
            {!form.user_id && (
              <p className="mt-1 text-xs text-slate-500">{t("未绑定时不会自动关联同名账号。")}</p>
            )}
            {selectedUser && (
              <div className="mt-1 text-[11px] text-slate-400">
                {t("系统账号：{account} · 状态 {status}", {
                  account: selectedUser.username ?? selectedUser.email ?? "",
                  status: selectedUser.status ?? "",
                })}
              </div>
            )}
          </Field>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label={t("姓名")} required error={errors.name}>
              <Input
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                className={cn(
                  "w-full rounded-md border bg-white px-3 py-2 text-sm text-slate-900 outline-none transition-colors focus:border-[#8fa9e8] focus:ring-2 focus:ring-[#dce5fa]",
                  errors.name ? "border-rose-300" : "border-slate-200",
                )}
                placeholder={t("例: 王磊")}
                data-autofocus
                aria-invalid={Boolean(errors.name)}
              />
            </Field>
            <Field label={t("职位")} required error={errors.position}>
              <Input
                value={form.position}
                onChange={(e) => setForm((f) => ({ ...f, position: e.target.value }))}
                className={cn(
                  "w-full rounded-md border bg-white px-3 py-2 text-sm text-slate-900 outline-none transition-colors focus:border-[#8fa9e8] focus:ring-2 focus:ring-[#dce5fa]",
                  errors.position ? "border-rose-300" : "border-slate-200",
                )}
                placeholder={t("硬件测试工程师")}
                aria-invalid={Boolean(errors.position)}
              />
            </Field>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label={t("所属组")} group>
              {creatingDept ? (
                <div className="flex items-center gap-1.5">
                  <Input
                    value={newDeptName}
                    onChange={(e) => setNewDeptName(e.target.value)}
                    placeholder={t("新分组名")}
                    aria-label={t("新分组名")}
                    autoFocus
                    onKeyDown={(e) => {
                      if (e.key === "Enter") { e.preventDefault(); void handleCreateDepartment(); }
                      else if (e.key === "Escape" && !savingNewDept) {
                        e.stopPropagation();
                        setCreatingDept(false);
                        setNewDeptName("");
                      }
                    }}
                    className="w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none transition-colors focus:border-[#8fa9e8] focus:ring-2 focus:ring-[#dce5fa]"
                  />
                  <button
                    type="button"
                    disabled={savingNewDept || Boolean(departmentError) || !newDeptName.trim()}
                    onClick={() => void handleCreateDepartment()}
                    className="shrink-0 rounded-md bg-[#002fa7] px-2 py-2 text-xs font-semibold text-white transition-colors hover:bg-[#001f73] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#002fa7] focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {savingNewDept ? t("保存中…") : t("保存")}
                  </button>
                  <button
                    type="button"
                    disabled={savingNewDept}
                    onClick={() => { setCreatingDept(false); setNewDeptName(""); }}
                    className="shrink-0 rounded-md border border-slate-200 bg-white px-2 py-2 text-xs font-semibold text-slate-600 transition-colors hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#002fa7] focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {t("取消")}
                  </button>
                </div>
              ) : (
                <div className="flex items-center gap-1.5">
                  <NativeSelect
                    value={form.department}
                    aria-label={t("所属组")}
                    disabled={Boolean(departmentError)}
                    onChange={(e) => {
                      const v = e.target.value;
                      if (v === "__create__") {
                        setCreatingDept(true);
                        return;
                      }
                      setForm((f) => ({ ...f, department: v }));
                    }}
                    className="w-full cursor-pointer rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none transition-colors focus:border-[#8fa9e8] focus:ring-2 focus:ring-[#dce5fa]"
                  >
                    {!form.department && <option value="">{t("未指定")}</option>}
                    {departments.map((d) => (
                      <option key={d} value={d}>
                        {d}
                      </option>
                    ))}
                    {canManageDepartments && (
                      <option value="__create__">{t("＋ 新建分组…")}</option>
                    )}
                  </NativeSelect>
                </div>
              )}
            </Field>
            <Field label={t("状态")}>
              <NativeSelect
                value={form.status}
                onChange={(e) =>
                  setForm((f) => ({ ...f, status: e.target.value as PersonStatus }))
                }
                className="w-full cursor-pointer rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none transition-colors focus:border-[#8fa9e8] focus:ring-2 focus:ring-[#dce5fa]"
              >
                <option value="active">{t("在岗")}</option>
                <option value="on_leave">{t("请假中")}</option>
                <option value="resigned">{t("已离职")}</option>
              </NativeSelect>
            </Field>
          </div>

          <Field label={t("邮箱")}>
            <Input
              type="email"
              value={form.email ?? ""}
              onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
              className="w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none transition-colors focus:border-[#8fa9e8] focus:ring-2 focus:ring-[#dce5fa]"
              placeholder="user@inogi.com"
            />
          </Field>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label={t("联系电话")}>
              <Input
                value={form.phone ?? ""}
                onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
                className="w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none transition-colors focus:border-[#8fa9e8] focus:ring-2 focus:ring-[#dce5fa]"
                placeholder="13800000000"
              />
            </Field>
            <Field label={t("任务上限")}>
              <Input
                type="number"
                min={1}
                max={20}
                value={form.max_tasks}
                onChange={(e) =>
                  setForm((f) => ({
                    ...f,
                    max_tasks: Math.max(1, Number(e.target.value) || 1),
                  }))
                }
                className="w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm tabular-nums text-slate-900 outline-none transition-colors focus:border-[#8fa9e8] focus:ring-2 focus:ring-[#dce5fa]"
              />
            </Field>
          </div>

          <Field label={t("知识库访问分值（0–100）")}>
            <div className="rd-people-access-control rounded-xl border border-slate-200 bg-slate-50/70 px-3 py-3">
              <div className="mb-3 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-sm font-semibold tabular-nums text-slate-900">{kbScore}/100</div>
                  <p className="mt-0.5 text-pretty text-[11px] text-slate-500">{t(kbScoreConfig.hint)}</p>
                </div>
                <Badge className={cn("shrink-0 gap-1 rounded-full border px-2.5 py-1 text-[11px] font-semibold", kbScoreConfig.badgeClass)}>
                  <ShieldCheck className="h-3 w-3" />
                  {t(kbScoreConfig.label)}
                </Badge>
              </div>
              <Slider
                aria-label={t("知识库访问分值")}
                aria-valuetext={t("{score} 分，{level}", { score: kbScore, level: t(kbScoreConfig.label) })}
                value={[kbScore]}
                min={0}
                max={100}
                step={5}
                onValueChange={([value]) => setForm((f) => ({ ...f, kb_level: clampAccessScore(value), kb_level_scale: "score" }))}
                className={cn(
                  "w-full [&_[data-slot=slider-track]]:h-2 [&_[data-slot=slider-thumb]]:size-4",
                  kbScoreConfig.sliderClass,
                )}
              />
              <div className="mt-2 flex items-center justify-between text-[10px] text-slate-400">
                <span>{t("0 公开")}</span>
                <span>25</span>
                <span>50</span>
                <span>75</span>
                <span>{t("100 最高")}</span>
              </div>
            </div>
            <p className="mt-1 text-pretty text-[11px] text-slate-400">{t("该成员可查看“文件权限分值 ≤ 成员分值”的所有知识库文件。")}</p>
          </Field>

          <footer className="rd-people-dialog-footer flex items-center justify-end gap-2 border-t border-slate-100 pt-4">
            <Button
              type="button"
              variant="outline"
              onClick={closeModal}
              disabled={saving || savingNewDept}
              className="h-9 rounded-md border-slate-200 px-4 text-sm font-medium text-slate-700"
            >
              {t("取消")}
            </Button>
            <Button
              type="submit"
              disabled={saving || !dependenciesReady}
              aria-busy={saving}
              className="rd-people-dialog-primary h-9 gap-1.5 rounded-md bg-[#002fa7] px-4 text-sm font-semibold text-white hover:bg-[#001f73] focus-visible:ring-[#002fa7] disabled:cursor-not-allowed disabled:opacity-60"
            >
              {saving ? t("保存中…") : isEdit ? t("保存修改") : t("创建成员")}
              {!saving && <ArrowRight className="h-3.5 w-3.5" />}
            </Button>
          </footer>
        </form>
      </div>
    </div>
  );

  return isHorizon && typeof document !== "undefined"
    ? createPortal(dialog, document.body)
    : dialog;
}

// ─── Confirm delete dialog ───────────────────────────────────────────────────

function ConfirmDeleteDialog({
  person,
  visualVariant,
  busy,
  onConfirm,
  onCancel,
}: {
  person: Person;
  visualVariant: RDPeopleVisualVariant;
  busy: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  useI18n();
  const isHorizon = visualVariant === "rd-horizon";
  const titleId = useId();
  const descriptionId = useId();
  const dialogRef = useDialogFocus(onCancel, isHorizon);
  const dialog = (
    <div
      className={cn(
        "fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 px-4",
        isHorizon && "rd-horizon-people-dialog-overlay",
      )}
    >
      <div
        ref={dialogRef}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        tabIndex={-1}
        className={cn(
          "w-full max-w-sm overflow-hidden rounded-2xl bg-white shadow-[0_24px_60px_rgba(15,23,42,0.2)]",
          isHorizon && "rd-horizon-people-dialog rd-horizon-people-delete-dialog",
        )}
      >
        <div className="rd-people-delete-body px-6 pt-6">
          <div className="mb-4 flex size-12 items-center justify-center rounded-full bg-rose-50">
            <AlertTriangle className="size-6 text-rose-600" />
          </div>
          <h3 id={titleId} className="text-balance text-base font-semibold text-slate-900">{t("删除 {name}?", { name: person.name })}</h3>
          <p id={descriptionId} className="mt-1.5 text-pretty text-sm leading-relaxed text-slate-500">
            {t("此操作将永久删除该成员的档案，关联任务将转为待指派状态。删除后无法撤销。")}
          </p>
        </div>
        <footer className="rd-people-dialog-footer mt-5 flex items-center justify-end gap-2 border-t border-slate-100 bg-slate-50/50 px-6 py-3">
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            data-autofocus
            className="rounded-md border border-slate-200 bg-white px-3.5 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#002fa7] focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {t("取消")}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy}
            aria-busy={busy}
            className="inline-flex items-center gap-1.5 rounded-md bg-rose-600 px-3.5 py-2 text-sm font-semibold text-white transition-colors hover:bg-rose-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-600 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <Trash2 className="size-3.5" />
            {busy ? t("删除中…") : t("确认删除")}
          </button>
        </footer>
      </div>
    </div>
  );

  return isHorizon && typeof document !== "undefined"
    ? createPortal(dialog, document.body)
    : dialog;
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export function RDPeopleManagementPage({
  onBack,
  initialPeople = INITIAL_PEOPLE,
  visualVariant = "default",
}: {
  onBack: () => void;
  initialPeople?: Person[];
  visualVariant?: RDPeopleVisualVariant;
}) {
  useI18n();
  const isHorizon = visualVariant === "rd-horizon";
  const [people, setPeople] = useState<Person[]>(initialPeople);
  const [keyword, setKeyword] = useState("");
  const [statusFilter, setStatusFilter] = useState<PersonStatus | "all">("all");
  const [deptFilter, setDeptFilter] = useState<string>("all");
  const [editing, setEditing] = useState<Person | null>(null);
  const [creating, setCreating] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Person | null>(null);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reloadVersion, setReloadVersion] = useState(0);
  const [savingPerson, setSavingPerson] = useState(false);
  const [deletingPerson, setDeletingPerson] = useState(false);
  const [systemUsers, setSystemUsers] = useState<RdIdentityUser[]>([]);
  const [identityOptionsError, setIdentityOptionsError] = useState<string | null>(null);
  const canManagePeople = usePermission(PERMISSIONS.RD_PEOPLE_MANAGE);

  useEffect(() => {
    let cancelled = false;
    async function loadPeople() {
      setLoading(true);
      setLoadError(null);
      try {
        const raw = await fetchRdPeople();
        if (cancelled) return;
        const remotePeople = raw.map(personFromLoad);
        setPeople(remotePeople);
        if (canManagePeople) {
          try {
            const users = await fetchRdPeopleUserOptions();
            if (cancelled) return;
            setSystemUsers(users);
            setIdentityOptionsError(null);
          } catch (error) {
            if (cancelled) return;
            setSystemUsers([]);
            setIdentityOptionsError(error instanceof Error ? error.message : t("登录用户列表读取失败"));
          }
        } else {
          setSystemUsers([]);
          setIdentityOptionsError(null);
        }
      } catch (error) {
        if (cancelled) return;
        setLoadError(error instanceof Error ? error.message : t("研发成员接口加载失败"));
        setPeople(initialPeople);
        if (canManagePeople) {
          setSystemUsers([]);
          setIdentityOptionsError(t("研发成员数据未读取成功，无法验证登录用户关联"));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void loadPeople();
    return () => {
      cancelled = true;
    };
  }, [canManagePeople, initialPeople, reloadVersion]);

  const deferredKeyword = useDeferredValue(keyword.trim().toLowerCase());

  const filtered = useMemo(() => {
    return people.filter((p) => {
      if (statusFilter !== "all" && p.status !== statusFilter) return false;
      if (deptFilter !== "all" && p.department !== deptFilter) return false;
      if (!deferredKeyword) return true;
      const k = deferredKeyword;
      return (
        p.name.toLowerCase().includes(k) ||
        p.position.toLowerCase().includes(k) ||
        p.department.toLowerCase().includes(k) ||
        (p.username?.toLowerCase().includes(k) ?? false) ||
        (p.email?.toLowerCase().includes(k) ?? false)
      );
    });
  }, [people, deferredKeyword, statusFilter, deptFilter]);

  const departmentFilters = useMemo(
    () =>
      Array.from(new Set(people.map((person) => person.department.trim()).filter(Boolean)))
        .sort((a, b) => a.localeCompare(b, "zh-CN")),
    [people],
  );

  const totalPages = Math.max(1, Math.ceil(filtered.length / PEOPLE_PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const pagedPeople = useMemo(
    () => filtered.slice(
      (safePage - 1) * PEOPLE_PAGE_SIZE,
      safePage * PEOPLE_PAGE_SIZE,
    ),
    [filtered, safePage],
  );
  const firstItem = filtered.length === 0 ? 0 : (safePage - 1) * PEOPLE_PAGE_SIZE + 1;
  const lastItem = Math.min(safePage * PEOPLE_PAGE_SIZE, filtered.length);

  const stats = useMemo(() => {
    const departments = new Set<string>();
    let active = 0;
    let onLeave = 0;
    let resigned = 0;
    let overloaded = 0;
    for (const person of people) {
      if (person.status === "active") active += 1;
      else if (person.status === "on_leave") onLeave += 1;
      else if (person.status === "resigned") resigned += 1;
      if (person.department) departments.add(person.department);
      if (person.max_tasks > 0 && (person.task_count ?? 0) > person.max_tasks) overloaded += 1;
    }
    return { total: people.length, active, onLeave, resigned, departments: departments.size, overloaded };
  }, [people]);

  const handleSave = async (p: Person) => {
    if (savingPerson) return;
    if (!canManagePeople) {
      toast.error(t("当前账号没有管理研发人员权限"));
      return;
    }
    setSavingPerson(true);
    try {
      if (editing) {
        const saved = await updateRdPerson({ ...personToMutation(p), id: editing.id });
        const savedPerson = personFromLoad(saved);
        setPeople((prev) => prev.map((x) => (x.id === savedPerson.id ? savedPerson : x)));
        setEditing(null);
        toast.success(t("研发成员已保存"));
      } else {
        const saved = await createRdPerson(personToMutation(p));
        const savedPerson = personFromLoad(saved);
        setPeople((prev) => [savedPerson, ...prev]);
        setCreating(false);
        toast.success(t("研发成员已创建"));
      }
      setPage(1);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : editing ? t("保存研发成员失败") : t("创建研发成员失败"));
    } finally {
      setSavingPerson(false);
    }
  };

  const handleDelete = async () => {
    if (deletingPerson) return;
    if (!canManagePeople) {
      toast.error(t("当前账号没有管理研发人员权限"));
      return;
    }
    if (deleteTarget) {
      setDeletingPerson(true);
      try {
        await deleteRdPerson(deleteTarget.id);
        setPeople((prev) => prev.filter((p) => p.id !== deleteTarget.id));
        setDeleteTarget(null);
        setPage(1);
        toast.success(t("研发成员已删除"));
      } catch (error) {
        toast.error(error instanceof Error ? error.message : t("删除研发成员失败"));
      } finally {
        setDeletingPerson(false);
      }
    }
  };

  return (
    <div
      className={cn(
        "rd-people-page flex min-h-full flex-col overflow-hidden bg-slate-50/40",
        isHorizon && "rd-horizon-module rd-horizon-people",
      )}
      data-visual-variant={visualVariant}
    >
      {/* Breadcrumb top bar */}
      <div className="rd-people-context flex items-center justify-between gap-3 border-b border-slate-200/80 bg-white px-5 py-2.5">
        <div className="rd-people-breadcrumb flex items-center gap-3">
          <button
            type="button"
            onClick={onBack}
            className="rd-people-back flex items-center gap-1.5 rounded-md px-2 py-1 text-sm font-medium text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#002fa7] focus-visible:ring-offset-2"
          >
            <ChevronLeft className="size-4" />
            {t("返回")}
          </button>
          <span className="text-xs text-slate-300">·</span>
          <span className="text-sm text-slate-500">{t("详情视图")}</span>
          <span className="text-xs text-slate-300">›</span>
          <span className="text-sm font-medium text-slate-800">{t("人员管理")}</span>
        </div>
        {canManagePeople ? (
          <button
            type="button"
            onClick={() => setCreating(true)}
            className="rd-people-primary inline-flex items-center gap-1.5 rounded-md bg-[#002fa7] px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-[#001f73] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#002fa7] focus-visible:ring-offset-2"
          >
            <Plus className="h-3.5 w-3.5" />
            {t("新增成员")}
          </button>
        ) : (
          <span className="rd-people-readonly rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-medium text-slate-500">
            {t("只读")}
          </span>
        )}
      </div>

      <div className="rd-people-viewport flex-1 overflow-auto px-6 py-6">
        <div className="rd-people-shell mx-auto max-w-6xl space-y-5 rd-stagger-children">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-balance text-xl font-semibold text-slate-950">{t("研发人员与负载")}</h2>
              <p className="mt-1 max-w-2xl text-pretty text-sm text-slate-500">
                {t("查看成员归属、任务容量与阻塞风险，优先处理超负载人员。")}
              </p>
            </div>
            {stats.overloaded > 0 && (
              <div className="inline-flex items-center gap-2 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-700">
                <AlertTriangle className="size-4" aria-hidden="true" />
                <span>{t("{count} 人超负载", { count: stats.overloaded })}</span>
              </div>
            )}
          </div>

          {loadError && (
            <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
              <div className="flex min-w-0 items-start gap-2">
                <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                <p className="text-pretty">{loadError}</p>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={loading}
                onClick={() => setReloadVersion((version) => version + 1)}
                className="shrink-0 border-amber-300 bg-white text-amber-900 focus-visible:ring-amber-600"
              >
                <RefreshCw className={cn("size-3.5", loading && "animate-spin")} aria-hidden="true" />
                {loading ? t("重试中…") : t("重新加载")}
              </Button>
            </div>
          )}

          {/* Stats strip */}
          <section className="rd-people-stats overflow-hidden rounded-xl border border-slate-100 bg-white">
            <div className="rd-people-stats-grid grid grid-cols-2 divide-x divide-slate-100 sm:grid-cols-3 lg:grid-cols-5">
              <div className="rd-people-stat px-6 py-4" data-tone="neutral">
                <div className="text-3xl font-semibold tabular-nums text-slate-900">
                  {stats.total}
                </div>
                <div className="mt-1 text-[11px] font-medium text-slate-500">{t("总成员数")}</div>
              </div>
              <div className="rd-people-stat px-6 py-4" data-tone="success">
                <div className="text-3xl font-semibold tabular-nums text-emerald-600">
                  {stats.active}
                </div>
                <div className="mt-1 text-[11px] font-medium text-slate-500">{t("在岗")}</div>
              </div>
              <div className="rd-people-stat px-6 py-4" data-tone="warning">
                <div
                  className={cn(
                    "text-3xl font-semibold tabular-nums",
                    stats.onLeave > 0 ? "text-amber-600" : "text-slate-300",
                  )}
                >
                  {stats.onLeave}
                </div>
                <div className="mt-1 text-[11px] font-medium text-slate-500">{t("请假中")}</div>
              </div>
              <div className="rd-people-stat px-6 py-4" data-tone="neutral">
                <div className="text-3xl font-semibold tabular-nums text-slate-900">
                  {stats.departments}
                </div>
                <div className="mt-1 text-[11px] font-medium text-slate-500">{t("所属组")}</div>
              </div>
              <div className="rd-people-stat px-6 py-4" data-tone="danger">
                <div className={cn("text-3xl font-semibold tabular-nums", stats.overloaded > 0 ? "text-rose-600" : "text-slate-300")}>
                  {stats.overloaded}
                </div>
                <div className="mt-1 flex items-center gap-1 text-[11px] font-medium text-slate-500">
                  <AlertTriangle className="size-3" aria-hidden="true" />
                  {t("超负载")}
                </div>
              </div>
            </div>
          </section>

          {/* Filters */}
          <section className="rd-people-filters flex flex-wrap items-center gap-2 rounded-xl border border-slate-100 bg-white px-4 py-3">
            <div className="rd-people-search flex min-w-[min(260px,100%)] flex-1 items-center gap-2 rounded-md border border-slate-200 bg-white px-2.5 py-1.5 transition-colors focus-within:border-[#8fa9e8] focus-within:ring-2 focus-within:ring-[#dce5fa]">
              <Search className="h-3.5 w-3.5 text-slate-400" />
              <Input
                value={keyword}
                onChange={(e) => {
                  setKeyword(e.target.value);
                  setPage(1);
                }}
                placeholder={t("搜索姓名 / 职位 / 组 / 邮箱…")}
                aria-label={t("搜索姓名 / 职位 / 组 / 邮箱…")}
                className="flex-1 text-sm text-slate-900 outline-none placeholder:text-slate-400"
              />
              {keyword && (
                <button
                  type="button"
                  onClick={() => {
                    setKeyword("");
                    setPage(1);
                  }}
                  className="rounded p-0.5 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#002fa7]"
                  aria-label={t("清除搜索")}
                >
                  <X className="h-3 w-3" />
                </button>
              )}
            </div>

            <div className="rd-people-status-filter flex items-center gap-1 rounded-md border border-slate-200 bg-white p-0.5" role="group" aria-label={t("状态筛选")}>
              {(["all", "active", "on_leave", "resigned"] as const).map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => {
                    setStatusFilter(s);
                    setPage(1);
                  }}
                  aria-pressed={statusFilter === s}
                  data-status={s}
                  data-active={statusFilter === s}
                  className={cn(
                    "rounded border border-transparent px-2.5 py-1 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#002fa7] focus-visible:ring-offset-1",
                    statusFilter === s
                      ? "border-[#cbd8f6] bg-[#eef3ff] text-[#002fa7] ring-1 ring-[#dce5fa]"
                      : "text-slate-500 hover:bg-slate-100 hover:text-slate-700",
                  )}
                >
                  {s === "all" ? t("全部") : t(PERSON_STATUS_CONFIG[s].label)}
                </button>
              ))}
            </div>

            <NativeSelect
              value={deptFilter}
              aria-label={t("所属组筛选")}
              onChange={(e) => {
                setDeptFilter(e.target.value);
                setPage(1);
              }}
              className="rd-people-department-filter cursor-pointer rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-600 outline-none transition-colors focus:border-[#8fa9e8] focus:ring-2 focus:ring-[#dce5fa]"
            >
              <option value="all">{t("全部组")}</option>
              {departmentFilters.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </NativeSelect>

            <span className="rd-people-result-count ml-auto text-xs tabular-nums text-slate-400">
              {t("共 {shown} / {total} 人", { shown: filtered.length, total: people.length })}
            </span>
          </section>

          {/* Table */}
          <section className="rd-people-table-surface overflow-hidden rounded-xl border border-slate-100 bg-white">
            <div className="rd-people-table-scroll overflow-x-auto">
            <table className="rd-people-table w-full min-w-[1080px]">
              <thead>
                <tr className="border-b border-slate-100 bg-slate-50/60 text-[11px] font-semibold text-slate-500">
                  <th scope="col" className="px-6 py-3 text-left">{t("成员")}</th>
                  <th scope="col" className="px-4 py-3 text-left">{t("登录用户")}</th>
                  <th scope="col" className="px-4 py-3 text-left">{t("职位")}</th>
                  <th scope="col" className="px-4 py-3 text-left">{t("组")}</th>
                  <th scope="col" className="px-4 py-3 text-left">{t("状态")}</th>
                  <th scope="col" className="px-4 py-3 text-left">{t("任务负载")}</th>
                  <th scope="col" className="px-4 py-3 text-left">{t("知识库等级")}</th>
                  <th scope="col" className="px-4 py-3 text-left">{t("入职日期")}</th>
                  <th scope="col" className="px-4 py-3 text-right">{t("操作")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {loading ? (
                  <tr>
                    <td colSpan={9} className="px-6 py-8">
                      <div role="status" aria-live="polite" className="space-y-4">
                        <p className="text-center text-sm font-medium text-slate-500">{t("正在加载研发成员…")}</p>
                        {[0, 1, 2].map((item) => (
                          <div key={item} className="flex items-center gap-4" aria-hidden="true">
                            <span className="size-8 animate-pulse rounded-full bg-slate-200" />
                            <span className="h-3 w-36 animate-pulse rounded bg-slate-200" />
                            <span className="h-3 flex-1 animate-pulse rounded bg-slate-100" />
                            <span className="h-3 w-24 animate-pulse rounded bg-slate-200" />
                          </div>
                        ))}
                      </div>
                    </td>
                  </tr>
                ) : filtered.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="px-6 py-16 text-center">
                      <div role="status" className="text-sm font-semibold text-slate-600">
                        {people.length === 0 ? t("暂无研发成员") : t("没有匹配的成员")}
                      </div>
                      <div className="mx-auto mt-1 max-w-sm text-pretty text-xs leading-5 text-slate-400">
                        {people.length === 0
                          ? t("后端当前没有人员数据。创建成员后，任务分配和人员负载会使用真实接口数据。")
                          : t("当前筛选条件下没有可显示的成员。")}
                      </div>
                      <div className="mt-4 flex items-center justify-center gap-2">
                        {people.length === 0 && canManagePeople ? (
                          <button
                            type="button"
                            onClick={() => setCreating(true)}
                            className="rd-people-empty-primary inline-flex items-center gap-1.5 rounded-md bg-[#002fa7] px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-[#001f73] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#002fa7] focus-visible:ring-offset-2"
                          >
                            <Plus className="h-3.5 w-3.5" />
                            {t("新增成员")}
                          </button>
                        ) : people.length > 0 ? (
                          <button
                            type="button"
                            onClick={() => {
                              setKeyword("");
                              setStatusFilter("all");
                              setDeptFilter("all");
                              setPage(1);
                            }}
                            className="rd-people-reset rounded px-2 py-1 text-xs font-medium text-[#002fa7] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#002fa7]"
                          >
                            {t("重置筛选")}
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={() => setReloadVersion((version) => version + 1)}
                            className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 transition-colors hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#002fa7] focus-visible:ring-offset-2"
                          >
                            <RefreshCw className="size-3.5" aria-hidden="true" />
                            {t("刷新成员")}
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ) : (
                  pagedPeople.map((p) => {
                    const cfg = PERSON_STATUS_CONFIG[p.status] ?? PERSON_STATUS_CONFIG["active"];
                    const maxTasks = Math.max(1, p.max_tasks);
                    const taskCount = Math.max(0, p.task_count ?? 0);
                    const ownedTasks = p.tasks ?? [];
                    const loadPercentage = Math.min(100, Math.round((taskCount / maxTasks) * 100));
                    const isOverloaded = taskCount > maxTasks;
                    const isNearCapacity = !isOverloaded && loadPercentage >= 80;
                    const loadLabel = isOverloaded ? t("超负载") : isNearCapacity ? t("接近上限") : t("可承接");
                    return (
                      <tr
                        key={p.id}
                        className="rd-people-row group transition-colors duration-150 hover:bg-slate-50/60"
                        data-status={p.status}
                      >
                        <td className="px-6 py-3.5">
                          <div className="flex items-center gap-3">
                            <PersonAvatar name={p.name} />
                            <div className="min-w-0">
                              <div className="max-w-40 truncate text-sm font-medium text-slate-900" title={p.name}>{p.name}</div>
                              {p.email && (
                                <div className="mt-0.5 truncate text-[11px] text-slate-400">
                                  {p.email}
                                </div>
                              )}
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-3.5">
                          {p.user_id ? (
                            <div className="min-w-0">
                              <div className="truncate text-xs font-semibold text-slate-700">
                                {p.username ?? p.email ?? t("已绑定")}
                              </div>
                              <div className="mt-0.5 text-[11px] text-emerald-600">{t("已绑定")}</div>
                            </div>
                          ) : (
                            <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-700">
                              {t("未绑定")}
                            </span>
                          )}
                        </td>
                        <td className="max-w-40 px-4 py-3.5 text-sm text-slate-700">
                          <span className="block truncate" title={p.position}>{p.position}</span>
                        </td>
                        <td className="px-4 py-3.5">
                          <span className="inline-flex items-center gap-1.5 rounded-md bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-700">
                            {p.department}
                          </span>
                        </td>
                        <td className="px-4 py-3.5">
                          <span
                            className={cn(
                              "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-semibold",
                              cfg.bg,
                              cfg.text,
                            )}
                          >
                            <span className={cn("size-1.5 rounded-full", cfg.dot)} aria-hidden="true" />
                            {t(cfg.label)}
                          </span>
                        </td>
                        <td className="px-4 py-3.5">
                          <div className="min-w-36" title={ownedTasks.length > 0 ? ownedTasks.join("、") : t("暂无归属任务")}>
                            <div className="flex items-center justify-between gap-2 text-[11px]">
                              <span className={cn(
                                "inline-flex items-center gap-1 font-semibold",
                                isOverloaded ? "text-rose-700" : isNearCapacity ? "text-amber-700" : "text-[#002fa7]",
                              )}>
                                {(isOverloaded || (p.blocked_count ?? 0) > 0) && <AlertTriangle className="size-3" aria-hidden="true" />}
                                {loadLabel}
                              </span>
                              <span className="tabular-nums text-slate-600">{taskCount}/{maxTasks}</span>
                            </div>
                            <div
                              role="progressbar"
                              aria-label={t("{name} 的任务负载", { name: p.name })}
                              aria-valuemin={0}
                              aria-valuemax={100}
                              aria-valuenow={loadPercentage}
                              className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-slate-100"
                            >
                              <span
                                className={cn(
                                  "block h-full rounded-full",
                                  isOverloaded ? "bg-rose-500" : isNearCapacity ? "bg-amber-500" : "bg-[#002fa7]",
                                )}
                                style={{ width: `${loadPercentage}%` }}
                              />
                            </div>
                            <div className="mt-1 truncate text-[10px] text-slate-400">
                              {(p.blocked_count ?? 0) > 0
                                ? t("{count} 项阻塞", { count: p.blocked_count ?? 0 })
                                : ownedTasks[0] ?? t("暂无归属任务")}
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-3.5">
                          {(() => {
                            const score = clampAccessScore(p.kb_level);
                            const scoreCfg = getAccessScoreConfig(score);
                            return (
                              <div className="min-w-[150px] max-w-[190px]">
                                <div className="mb-1.5 flex items-center justify-between gap-2">
                                  <Badge className={cn("gap-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold", scoreCfg.badgeClass)}>
                                    <ShieldCheck className="h-3 w-3" />
                                    {t(scoreCfg.label)}
                                  </Badge>
                                  <span className="text-xs font-semibold tabular-nums text-slate-700">{score}</span>
                                </div>
                                <Slider
                                  value={[score]}
                                  min={0}
                                  max={100}
                                  step={5}
                                  disabled
                                  className={cn(
                                    "w-full [&_[data-slot=slider-track]]:h-1.5 [&_[data-slot=slider-thumb]]:hidden",
                                    scoreCfg.sliderClass,
                                  )}
                                />
                              </div>
                            );
                          })()}
                        </td>
                        <td className="px-4 py-3.5 text-xs tabular-nums text-slate-500">
                          {p.joined_at ?? "—"}
                        </td>
                        <td className="px-4 py-3.5">
                          {canManagePeople ? (
                            <div className="rd-people-row-actions flex items-center justify-end gap-1 opacity-100 lg:opacity-0 lg:transition-opacity lg:group-hover:opacity-100 lg:group-focus-within:opacity-100">
                              <button
                                type="button"
                                onClick={() => setEditing(p)}
                                data-action="edit"
                                className="rounded-md p-1.5 text-slate-400 transition-colors hover:bg-[#eef3ff] hover:text-[#002fa7] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#002fa7]"
                                aria-label={t("编辑 {name}", { name: p.name })}
                                title={t("编辑")}
                              >
                                <Pencil className="h-3.5 w-3.5" />
                              </button>
                              <button
                                type="button"
                                onClick={() => setDeleteTarget(p)}
                                data-action="delete"
                                className="rounded-md p-1.5 text-slate-400 transition-colors hover:bg-rose-50 hover:text-rose-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-600"
                                aria-label={t("删除 {name}", { name: p.name })}
                                title={t("删除")}
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
                            </div>
                          ) : (
                            <span className="flex justify-end text-xs text-slate-300">{t("只读")}</span>
                          )}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
            </div>
            {filtered.length > 0 && (
              <div className="rd-people-pagination flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 px-6 py-3">
                <div className="text-xs tabular-nums text-slate-400">
                  {t("显示 {from}-{to} / {total} 人", {
                    from: firstItem,
                    to: lastItem,
                    total: filtered.length,
                  })}
                </div>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => setPage((current) => Math.max(1, current - 1))}
                    disabled={safePage === 1}
                    data-direction="previous"
                    className="inline-flex size-8 items-center justify-center rounded-md border border-slate-200 bg-white text-slate-500 transition-colors hover:border-[#cbd8f6] hover:bg-[#eef3ff] hover:text-[#002fa7] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#002fa7] disabled:cursor-not-allowed disabled:opacity-35 disabled:hover:border-slate-200 disabled:hover:bg-white disabled:hover:text-slate-500"
                    aria-label={t("上一页")}
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </button>
                  {Array.from({ length: totalPages }).map((_, index) => {
                    const pageNumber = index + 1;
                    return (
                      <button
                        key={pageNumber}
                        type="button"
                        onClick={() => setPage(pageNumber)}
                        aria-current={safePage === pageNumber ? "page" : undefined}
                        data-active={safePage === pageNumber}
                        className={cn(
                          "h-8 min-w-8 rounded-md border px-2 text-xs font-semibold tabular-nums transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#002fa7]",
                          safePage === pageNumber
                            ? "border-[#cbd8f6] bg-[#eef3ff] text-[#002fa7] ring-1 ring-[#dce5fa]"
                            : "border-slate-200 bg-white text-slate-500 hover:border-[#cbd8f6] hover:bg-[#eef3ff] hover:text-[#002fa7]",
                        )}
                      >
                        {pageNumber}
                      </button>
                    );
                  })}
                  <button
                    type="button"
                    onClick={() => setPage((current) => Math.min(totalPages, current + 1))}
                    disabled={safePage === totalPages}
                    data-direction="next"
                    className="inline-flex size-8 items-center justify-center rounded-md border border-slate-200 bg-white text-slate-500 transition-colors hover:border-[#cbd8f6] hover:bg-[#eef3ff] hover:text-[#002fa7] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#002fa7] disabled:cursor-not-allowed disabled:opacity-35 disabled:hover:border-slate-200 disabled:hover:bg-white disabled:hover:text-slate-500"
                    aria-label={t("下一页")}
                  >
                    <ChevronRight className="h-4 w-4" />
                  </button>
                </div>
              </div>
            )}
          </section>
        </div>
      </div>

      {/* Modals */}
      {canManagePeople && (editing || creating) && (
        <PersonFormModal
          person={editing}
          users={systemUsers}
          identityOptionsError={identityOptionsError}
          onRetryIdentityOptions={() => setReloadVersion((version) => version + 1)}
          canManageDepartments={canManagePeople}
          visualVariant={visualVariant}
          saving={savingPerson}
          onSave={handleSave}
          onClose={() => {
            if (savingPerson) return;
            setEditing(null);
            setCreating(false);
          }}
        />
      )}
      {canManagePeople && deleteTarget && (
        <ConfirmDeleteDialog
          person={deleteTarget}
          visualVariant={visualVariant}
          busy={deletingPerson}
          onConfirm={handleDelete}
          onCancel={() => {
            if (!deletingPerson) setDeleteTarget(null);
          }}
        />
      )}
    </div>
  );
}

export default RDPeopleManagementPage;
