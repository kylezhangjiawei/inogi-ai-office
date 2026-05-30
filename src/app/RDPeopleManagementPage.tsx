import React, { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowRight,
  ChevronLeft,
  ChevronRight,
  Pencil,
  Plus,
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
import { AuditChange, recordAudit, useAuditActor } from "./lib/auditLog";
import { PERMISSIONS } from "./lib/permissions";
import {
  createRdPerson,
  deleteRdPerson,
  fetchRdPeople,
  fetchRdPeopleUserOptions,
  updateRdPerson,
  type RdIdentityUser,
} from "./lib/rdApi";
import { authFetch } from "./lib/authSession";

// ─── Department API（复用 /api/departments，独立于 RD API 前缀） ──────────────

type DepartmentOption = { id: string; code: string; name: string; category: string };

async function apiListDepartmentOptions(): Promise<DepartmentOption[]> {
  const res = await authFetch("/api/departments/options");
  if (!res.ok) throw new Error("获取分组列表失败");
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
    const msg = Array.isArray(err.message) ? err.message.join(", ") : (err.message ?? "新建分组失败");
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

const DEPARTMENTS = ["硬件组", "软件组", "质量组", "项目组", "工艺组", "法规组", "其他"];
const PEOPLE_PAGE_SIZE = 5;

// ─── Helpers ─────────────────────────────────────────────────────────────────

function hashColor(name: string): string {
  const colors = [
    "bg-blue-500",
    "bg-emerald-500",
    "bg-violet-500",
    "bg-amber-500",
    "bg-pink-500",
    "bg-cyan-500",
    "bg-indigo-500",
    "bg-rose-500",
    "bg-teal-500",
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
      badgeClass: "border-blue-200 bg-blue-50 text-blue-700",
      sliderClass: "[&_[data-slot=slider-range]]:bg-blue-500",
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
    badgeClass: "border-red-200 bg-red-50 text-red-700",
    sliderClass: "[&_[data-slot=slider-range]]:bg-red-500",
    hint: "最高权限，可查看全部资料",
  };
}

function PersonAvatar({ name }: { name: string }) {
  const initial = name.replace(/\(.+?\)/g, "").trim().slice(0, 1) || "?";
  return (
    <span
      className={cn(
        "inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold text-white ring-2 ring-white",
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
    kb_level: 20,
    kb_level_scale: "score",
  };
}

function getPersonChanges(before: Person, after: Person): AuditChange[] {
  const fields: Array<keyof Person> = ["user_id", "name", "position", "department", "email", "phone", "status", "max_tasks", "kb_level"];
  return fields
    .filter((field) => before[field] !== after[field])
    .map((field) => ({ field, before: before[field], after: after[field] }));
}

// ─── Form Field wrapper ──────────────────────────────────────────────────────

function Field({
  label,
  required,
  error,
  children,
}: {
  label: string;
  required?: boolean;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <div className="mb-1.5 flex items-baseline gap-1 text-xs font-medium text-slate-700">
        {label}
        {required && <span className="text-red-500">*</span>}
        {error && <span className="ml-auto text-[11px] font-normal text-red-500">{error}</span>}
      </div>
      {children}
    </label>
  );
}

// ─── Form modal ──────────────────────────────────────────────────────────────

function PersonFormModal({
  person,
  users,
  canManageDepartments,
  onSave,
  onClose,
}: {
  person: Person | null;
  users: RdIdentityUser[];
  canManageDepartments: boolean;
  onSave: (p: Person) => void;
  onClose: () => void;
}) {
  const isEdit = person !== null;
  const [form, setForm] = useState<Person>(person ?? emptyPerson());
  const [errors, setErrors] = useState<{ name?: string; position?: string }>({});
  // 切换编辑对象 / 重新打开同一个对象时，把表单 state 同步到最新 person prop，避免显示老数据
  useEffect(() => {
    setForm(person ?? emptyPerson());
    setErrors({});
  }, [person?.id]);

  // 分组选项：来自后端 /api/departments/options；失败时回退到旧的硬编码兜底
  const [departments, setDepartments] = useState<string[]>([]);
  const [creatingDept, setCreatingDept] = useState(false);
  const [newDeptName, setNewDeptName] = useState("");
  const [savingNewDept, setSavingNewDept] = useState(false);

  useEffect(() => {
    let cancelled = false;
    apiListDepartmentOptions()
      .then((list) => {
        if (cancelled) return;
        const names = list.map((d) => d.name).filter(Boolean);
        // 确保至少含有当前 form.department，避免编辑时下拉里没有当前值
        const merged = Array.from(new Set([...names, ...(form.department ? [form.department] : [])]));
        setDepartments(merged.length > 0 ? merged : DEPARTMENTS);
      })
      .catch(() => {
        if (!cancelled) setDepartments(DEPARTMENTS);
      });
    return () => { cancelled = true; };
    // 故意只在挂载时拉一次；新建后会手动 push 到 departments
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleCreateDepartment = async () => {
    const name = newDeptName.trim();
    if (!name) {
      toast.error("分组名称不能为空");
      return;
    }
    if (departments.includes(name)) {
      toast.error("该分组已存在");
      return;
    }
    setSavingNewDept(true);
    try {
      const created = await apiCreateDepartment(name);
      setDepartments((prev) => Array.from(new Set([...prev, created.name])));
      setForm((f) => ({ ...f, department: created.name }));
      toast.success(`已新建分组：${created.name}`);
      setCreatingDept(false);
      setNewDeptName("");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "新建分组失败");
    } finally {
      setSavingNewDept(false);
    }
  };

  const selectedUser = users.find((user) => user.id === form.user_id);
  const kbScore = clampAccessScore(form.kb_level);
  const kbScoreConfig = getAccessScoreConfig(kbScore);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const newErrors: typeof errors = {};
    if (!form.name.trim()) newErrors.name = "姓名不能为空";
    if (!form.position.trim()) newErrors.position = "职位不能为空";
    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors);
      return;
    }
    onSave({ ...form, kb_level: kbScore, kb_level_scale: "score" });
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 px-4 backdrop-blur-sm animate-rd-fade-in"
    >
      <div
        className="w-full max-w-md overflow-hidden rounded-2xl bg-white shadow-[0_24px_60px_rgba(15,23,42,0.2)] animate-rd-scale-in"
      >
        <header className="flex items-center justify-between border-b border-slate-100 px-6 py-4">
          <div>
            <h3 className="text-base font-semibold text-slate-900">
              {isEdit ? "编辑成员" : "新增成员"}
            </h3>
            <p className="mt-0.5 text-xs text-slate-500">
              {isEdit ? `修改 ${person!.name} 的信息` : "创建一个新的团队成员"}
            </p>
          </div>
          <button
            onClick={onClose}
            type="button"
            className="rounded-md p-1.5 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700"
            aria-label="关闭"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        <form onSubmit={handleSubmit} className="space-y-4 px-6 py-5">
          <Field label="绑定登录用户">
            <NativeSelect
              value={form.user_id ?? ""}
              onChange={(e) => {
                const user = users.find((item) => item.id === e.target.value);
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
              className="w-full cursor-pointer rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none transition-all focus:border-indigo-300 focus:ring-2 focus:ring-indigo-100"
            >
              <option value="">未绑定，按姓名兼容匹配</option>
              {users.map((user) => (
                <option key={user.id} value={user.id}>
                  {user.name} · {user.email}
                </option>
              ))}
            </NativeSelect>
            {selectedUser && (
              <div className="mt-1 text-[11px] text-slate-400">
                系统账号：{selectedUser.username ?? selectedUser.email} · 状态 {selectedUser.status}
              </div>
            )}
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label="姓名" required error={errors.name}>
              <Input
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                className={cn(
                  "w-full rounded-md border bg-white px-3 py-2 text-sm text-slate-900 outline-none transition-all focus:border-indigo-300 focus:ring-2 focus:ring-indigo-100",
                  errors.name ? "border-red-300" : "border-slate-200",
                )}
                placeholder="例: 王磊"
                autoFocus
              />
            </Field>
            <Field label="职位" required error={errors.position}>
              <Input
                value={form.position}
                onChange={(e) => setForm((f) => ({ ...f, position: e.target.value }))}
                className={cn(
                  "w-full rounded-md border bg-white px-3 py-2 text-sm text-slate-900 outline-none transition-all focus:border-indigo-300 focus:ring-2 focus:ring-indigo-100",
                  errors.position ? "border-red-300" : "border-slate-200",
                )}
                placeholder="硬件测试工程师"
              />
            </Field>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Field label="所属组">
              {creatingDept ? (
                <div className="flex items-center gap-1.5">
                  <Input
                    value={newDeptName}
                    onChange={(e) => setNewDeptName(e.target.value)}
                    placeholder="新分组名"
                    autoFocus
                    onKeyDown={(e) => {
                      if (e.key === "Enter") { e.preventDefault(); void handleCreateDepartment(); }
                      else if (e.key === "Escape") { setCreatingDept(false); setNewDeptName(""); }
                    }}
                    className="w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none transition-all focus:border-indigo-300 focus:ring-2 focus:ring-indigo-100"
                  />
                  <button
                    type="button"
                    disabled={savingNewDept || !newDeptName.trim()}
                    onClick={() => void handleCreateDepartment()}
                    className="shrink-0 rounded-md bg-indigo-600 px-2 py-2 text-xs font-semibold text-white transition-colors hover:bg-indigo-700 disabled:opacity-60"
                  >
                    {savingNewDept ? "..." : "保存"}
                  </button>
                  <button
                    type="button"
                    onClick={() => { setCreatingDept(false); setNewDeptName(""); }}
                    className="shrink-0 rounded-md border border-slate-200 bg-white px-2 py-2 text-xs font-semibold text-slate-600 transition-colors hover:bg-slate-50"
                  >
                    取消
                  </button>
                </div>
              ) : (
                <div className="flex items-center gap-1.5">
                  <NativeSelect
                    value={form.department}
                    onChange={(e) => {
                      const v = e.target.value;
                      if (v === "__create__") {
                        setCreatingDept(true);
                        return;
                      }
                      setForm((f) => ({ ...f, department: v }));
                    }}
                    className="w-full cursor-pointer rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none transition-all focus:border-indigo-300 focus:ring-2 focus:ring-indigo-100"
                  >
                    {!form.department && <option value="">未指定</option>}
                    {departments.map((d) => (
                      <option key={d} value={d}>
                        {d}
                      </option>
                    ))}
                    {canManageDepartments && (
                      <option value="__create__">＋ 新建分组…</option>
                    )}
                  </NativeSelect>
                </div>
              )}
            </Field>
            <Field label="状态">
              <NativeSelect
                value={form.status}
                onChange={(e) =>
                  setForm((f) => ({ ...f, status: e.target.value as PersonStatus }))
                }
                className="w-full cursor-pointer rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none transition-all focus:border-indigo-300 focus:ring-2 focus:ring-indigo-100"
              >
                <option value="active">在岗</option>
                <option value="on_leave">请假中</option>
                <option value="resigned">已离职</option>
              </NativeSelect>
            </Field>
          </div>

          <Field label="邮箱">
            <Input
              type="email"
              value={form.email ?? ""}
              onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
              className="w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none transition-all focus:border-indigo-300 focus:ring-2 focus:ring-indigo-100"
              placeholder="user@inogi.com"
            />
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label="联系电话">
              <Input
                value={form.phone ?? ""}
                onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
                className="w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none transition-all focus:border-indigo-300 focus:ring-2 focus:ring-indigo-100"
                placeholder="13800000000"
              />
            </Field>
            <Field label="任务上限">
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
                className="w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none transition-all focus:border-indigo-300 focus:ring-2 focus:ring-indigo-100"
              />
            </Field>
          </div>

          <Field label="知识库访问分值（0–100）">
            <div className="rounded-xl border border-slate-200 bg-slate-50/70 px-3 py-3">
              <div className="mb-3 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-sm font-semibold tabular-nums text-slate-900">{kbScore}/100</div>
                  <p className="mt-0.5 text-[11px] text-slate-500">{kbScoreConfig.hint}</p>
                </div>
                <Badge className={cn("shrink-0 gap-1 rounded-full border px-2.5 py-1 text-[11px] font-semibold", kbScoreConfig.badgeClass)}>
                  <ShieldCheck className="h-3 w-3" />
                  {kbScoreConfig.label}
                </Badge>
              </div>
              <Slider
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
                <span>0 公开</span>
                <span>25</span>
                <span>50</span>
                <span>75</span>
                <span>100 最高</span>
              </div>
            </div>
            <p className="mt-1 text-[11px] text-slate-400">该成员可查看“文件权限分值 ≤ 成员分值”的所有知识库文件。</p>
          </Field>

          <footer className="flex items-center justify-end gap-2 border-t border-slate-100 pt-4">
            <Button
              type="button"
              variant="outline"
              onClick={onClose}
              className="h-9 rounded-md border-slate-200 px-4 text-sm font-medium text-slate-700"
            >
              取消
            </Button>
            <Button
              type="submit"
              className="h-9 gap-1.5 rounded-md bg-indigo-600 px-4 text-sm font-semibold text-white shadow-[0_8px_18px_rgba(79,70,229,0.2)] hover:bg-indigo-700"
            >
              {isEdit ? "保存修改" : "创建成员"}
              <ArrowRight className="h-3.5 w-3.5" />
            </Button>
          </footer>
        </form>
      </div>
    </div>
  );
}

// ─── Confirm delete dialog ───────────────────────────────────────────────────

function ConfirmDeleteDialog({
  person,
  onConfirm,
  onCancel,
}: {
  person: Person;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 px-4 backdrop-blur-sm animate-rd-fade-in"
    >
      <div
        className="w-full max-w-sm overflow-hidden rounded-2xl bg-white shadow-[0_24px_60px_rgba(15,23,42,0.2)] animate-rd-scale-in"
      >
        <div className="px-6 pt-6">
          <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-red-50">
            <AlertTriangle className="h-6 w-6 text-red-500" />
          </div>
          <h3 className="text-base font-semibold text-slate-900">删除 {person.name}?</h3>
          <p className="mt-1.5 text-sm leading-relaxed text-slate-500">
            此操作将永久删除该成员的档案，关联任务将转为待指派状态。删除后无法撤销。
          </p>
        </div>
        <footer className="mt-5 flex items-center justify-end gap-2 border-t border-slate-100 bg-slate-50/50 px-6 py-3">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-md border border-slate-200 bg-white px-3.5 py-2 text-sm font-medium text-slate-700 transition-all duration-150 hover:bg-slate-50 active:scale-[0.98]"
          >
            取消
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="inline-flex items-center gap-1.5 rounded-md bg-red-600 px-3.5 py-2 text-sm font-semibold text-white shadow-[0_8px_18px_rgba(220,38,38,0.25)] transition-all duration-150 hover:bg-red-700 active:scale-[0.98]"
          >
            <Trash2 className="h-3.5 w-3.5" />
            确认删除
          </button>
        </footer>
      </div>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export function RDPeopleManagementPage({
  onBack,
  initialPeople = INITIAL_PEOPLE,
}: {
  onBack: () => void;
  initialPeople?: Person[];
}) {
  const PEOPLE_AUDIT_ACTOR = useAuditActor("研发主管");
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
  const [systemUsers, setSystemUsers] = useState<RdIdentityUser[]>([]);
  const canManagePeople = usePermission(PERMISSIONS.RD_PEOPLE_MANAGE);

  useEffect(() => {
    let cancelled = false;
    async function loadPeople() {
      setLoading(true);
      setLoadError(null);
      try {
        const [raw, users] = await Promise.all([
          fetchRdPeople(),
          canManagePeople ? fetchRdPeopleUserOptions().catch(() => []) : Promise.resolve([]),
        ]);
        if (cancelled) return;
        setSystemUsers(users);
        const remotePeople: Person[] = raw.map((p) => ({
          id: p.id,
          user_id: p.user_id ?? null,
          name: p.name,
          position: p.position,
          department: (p as Person & { department?: string }).department ?? "",
          email: p.email,
          username: p.username ?? null,
          user_status: p.user_status ?? null,
          phone: p.phone,
          status: (
            ((p as Person & { status?: string }).status as PersonStatus | undefined) ??
            (p.on_leave ? "on_leave" : "active")
          ),
          max_tasks: p.max_tasks,
          joined_at: (p as Person & { joined_at?: string }).joined_at,
          // ⚠️ 之前漏映射了 kb_level / kb_level_scale，导致页面 fallback 全显示 20
          kb_level: typeof p.kb_level === "number" ? p.kb_level : undefined,
          kb_level_scale: p.kb_level_scale === "score" ? "score" : undefined,
        }));
        setPeople(remotePeople);
      } catch (error) {
        if (cancelled) return;
        setLoadError(error instanceof Error ? error.message : "研发成员接口加载失败");
        setPeople(initialPeople);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void loadPeople();
    return () => {
      cancelled = true;
    };
  }, [canManagePeople, initialPeople]);

  const filtered = useMemo(() => {
    return people.filter((p) => {
      if (statusFilter !== "all" && p.status !== statusFilter) return false;
      if (deptFilter !== "all" && p.department !== deptFilter) return false;
      if (!keyword) return true;
      const k = keyword.toLowerCase();
      return (
        p.name.toLowerCase().includes(k) ||
        p.position.toLowerCase().includes(k) ||
        p.department.toLowerCase().includes(k) ||
        (p.username?.toLowerCase().includes(k) ?? false) ||
        (p.email?.toLowerCase().includes(k) ?? false)
      );
    });
  }, [people, keyword, statusFilter, deptFilter]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PEOPLE_PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const pagedPeople = filtered.slice(
    (safePage - 1) * PEOPLE_PAGE_SIZE,
    safePage * PEOPLE_PAGE_SIZE,
  );
  const firstItem = filtered.length === 0 ? 0 : (safePage - 1) * PEOPLE_PAGE_SIZE + 1;
  const lastItem = Math.min(safePage * PEOPLE_PAGE_SIZE, filtered.length);

  const stats = useMemo(() => {
    return {
      total: people.length,
      active: people.filter((p) => p.status === "active").length,
      onLeave: people.filter((p) => p.status === "on_leave").length,
      resigned: people.filter((p) => p.status === "resigned").length,
      departments: new Set(people.map((p) => p.department)).size,
    };
  }, [people]);

  const handleSave = async (p: Person) => {
    if (!canManagePeople) {
      toast.error("当前账号没有管理研发人员权限");
      return;
    }
    if (editing) {
      try {
        const saved = await updateRdPerson({ ...p, id: editing.id });
        const changes = getPersonChanges(editing, saved);
        setPeople((prev) => prev.map((x) => (x.id === saved.id ? saved : x)));
        recordAudit({
          actor: PEOPLE_AUDIT_ACTOR,
          action: changes.some((change) => change.field === "status") ? "person.status_changed" : "person.edited",
          resource: { type: "person", id: saved.id, name: saved.name },
          changes,
          comment: "维护研发成员信息",
          source: "web",
        });
        setEditing(null);
        toast.success("研发成员已保存");
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "保存研发成员失败");
        return;
      }
    } else {
      try {
        const saved = await createRdPerson({ ...p, id: p.id || undefined });
        setPeople((prev) => [saved, ...prev]);
        recordAudit({
          actor: PEOPLE_AUDIT_ACTOR,
          action: "person.created",
          resource: { type: "person", id: saved.id, name: saved.name },
          metadata: { department: saved.department, position: saved.position },
          source: "web",
        });
        setCreating(false);
        toast.success("研发成员已创建");
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "创建研发成员失败");
        return;
      }
    }
    setPage(1);
  };

  const handleDelete = async () => {
    if (!canManagePeople) {
      toast.error("当前账号没有管理研发人员权限");
      return;
    }
    if (deleteTarget) {
      try {
        await deleteRdPerson(deleteTarget.id);
        setPeople((prev) => prev.filter((p) => p.id !== deleteTarget.id));
        recordAudit({
          actor: PEOPLE_AUDIT_ACTOR,
          action: "person.deleted",
          resource: { type: "person", id: deleteTarget.id, name: deleteTarget.name },
          comment: "删除研发成员档案，关联任务需重新指派",
          metadata: { department: deleteTarget.department, position: deleteTarget.position },
          source: "web",
        });
        setDeleteTarget(null);
        setPage(1);
        toast.success("研发成员已删除");
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "删除研发成员失败");
      }
    }
  };

  return (
    <div className="flex min-h-full flex-col overflow-hidden bg-slate-50/40 animate-rd-fade-in">
      {/* Breadcrumb top bar */}
      <div className="flex items-center justify-between gap-3 border-b border-slate-200/80 bg-white px-5 py-2.5">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onBack}
            className="group flex items-center gap-1.5 rounded-md px-2 py-1 text-sm font-medium text-slate-600 transition-all duration-200 hover:bg-slate-100 hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-300 active:scale-[0.96]"
          >
            <ChevronLeft className="h-4 w-4 transition-transform duration-200 ease-out group-hover:-translate-x-0.5" />
            返回
          </button>
          <span className="text-xs text-slate-300">·</span>
          <span className="text-sm text-slate-500">详情视图</span>
          <span className="text-xs text-slate-300">›</span>
          <span className="text-sm font-medium text-slate-800">人员管理</span>
        </div>
        {canManagePeople ? (
          <button
            type="button"
            onClick={() => setCreating(true)}
            className="inline-flex items-center gap-1.5 rounded-md bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white shadow-[0_8px_18px_rgba(79,70,229,0.2)] transition-all duration-150 hover:-translate-y-0.5 hover:bg-indigo-700 hover:shadow-[0_12px_24px_rgba(79,70,229,0.22)] active:scale-[0.98]"
          >
            <Plus className="h-3.5 w-3.5" />
            新增成员
          </button>
        ) : (
          <span className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-medium text-slate-500">
            只读
          </span>
        )}
      </div>

      <div className="flex-1 overflow-auto px-6 py-6">
        <div className="mx-auto max-w-6xl space-y-5 rd-stagger-children">
          {/* Stats strip */}
          <section className="overflow-hidden rounded-xl border border-slate-100 bg-white">
            <div className="grid grid-cols-2 divide-x divide-slate-100 md:grid-cols-4">
              <div className="px-6 py-4">
                <div className="text-3xl font-semibold tabular-nums tracking-tight text-slate-900">
                  {stats.total}
                </div>
                <div className="mt-1 text-[11px] font-medium text-slate-500">总成员数</div>
              </div>
              <div className="px-6 py-4">
                <div className="text-3xl font-semibold tabular-nums tracking-tight text-emerald-600">
                  {stats.active}
                </div>
                <div className="mt-1 text-[11px] font-medium text-slate-500">在岗</div>
              </div>
              <div className="px-6 py-4">
                <div
                  className={cn(
                    "text-3xl font-semibold tabular-nums tracking-tight",
                    stats.onLeave > 0 ? "text-amber-600" : "text-slate-300",
                  )}
                >
                  {stats.onLeave}
                </div>
                <div className="mt-1 text-[11px] font-medium text-slate-500">请假中</div>
              </div>
              <div className="px-6 py-4">
                <div className="text-3xl font-semibold tabular-nums tracking-tight text-slate-900">
                  {stats.departments}
                </div>
                <div className="mt-1 text-[11px] font-medium text-slate-500">所属组</div>
              </div>
            </div>
          </section>

          {/* Filters */}
          <section className="flex flex-wrap items-center gap-2 rounded-xl border border-slate-100 bg-white px-4 py-3">
            <div className="flex min-w-[260px] flex-1 items-center gap-2 rounded-md border border-slate-200 bg-white px-2.5 py-1.5 transition-all focus-within:border-indigo-300 focus-within:ring-2 focus-within:ring-indigo-100">
              <Search className="h-3.5 w-3.5 text-slate-400" />
              <Input
                value={keyword}
                onChange={(e) => {
                  setKeyword(e.target.value);
                  setPage(1);
                }}
                placeholder="搜索姓名 / 职位 / 组 / 邮箱…"
                className="flex-1 text-sm text-slate-900 outline-none placeholder:text-slate-400"
              />
              {keyword && (
                <button
                  type="button"
                  onClick={() => {
                    setKeyword("");
                    setPage(1);
                  }}
                  className="rounded p-0.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                  aria-label="清除搜索"
                >
                  <X className="h-3 w-3" />
                </button>
              )}
            </div>

            <div className="flex items-center gap-1 rounded-md border border-slate-200 bg-white p-0.5">
              {(["all", "active", "on_leave", "resigned"] as const).map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => {
                    setStatusFilter(s);
                    setPage(1);
                  }}
                  className={cn(
                    "rounded border border-transparent px-2.5 py-1 text-xs font-medium transition-all duration-150 active:scale-95",
                    statusFilter === s
                      ? "border-indigo-200 bg-indigo-50 text-indigo-700 shadow-[0_6px_14px_rgba(79,70,229,0.08)] ring-1 ring-indigo-100"
                      : "text-slate-500 hover:bg-slate-100 hover:text-slate-700",
                  )}
                >
                  {s === "all" ? "全部" : PERSON_STATUS_CONFIG[s].label}
                </button>
              ))}
            </div>

            <NativeSelect
              value={deptFilter}
              onChange={(e) => {
                setDeptFilter(e.target.value);
                setPage(1);
              }}
              className="cursor-pointer rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-600 outline-none transition-all focus:border-indigo-300 focus:ring-2 focus:ring-indigo-100"
            >
              <option value="all">全部组</option>
              {DEPARTMENTS.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </NativeSelect>

            <span className="ml-auto text-xs tabular-nums text-slate-400">
              共 <span className="font-semibold text-slate-700">{filtered.length}</span> /{" "}
              {people.length} 人
            </span>
          </section>

          {/* Table */}
          <section className="overflow-hidden rounded-xl border border-slate-100 bg-white">
            <table className="w-full">
              <thead>
                <tr className="border-b border-slate-100 bg-slate-50/60 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                  <th className="px-6 py-3 text-left">成员</th>
                  <th className="px-4 py-3 text-left">登录用户</th>
                  <th className="px-4 py-3 text-left">职位</th>
                  <th className="px-4 py-3 text-left">组</th>
                  <th className="px-4 py-3 text-left">状态</th>
                  <th className="px-4 py-3 text-left">知识库等级</th>
                  <th className="px-4 py-3 text-left">入职日期</th>
                  <th className="px-4 py-3 text-right">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {loading ? (
                  <tr>
                    <td colSpan={8} className="px-6 py-16 text-center">
                      <div className="text-sm font-medium text-slate-500">正在加载研发成员…</div>
                    </td>
                  </tr>
                ) : filtered.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="px-6 py-16 text-center">
                      <div className="text-sm font-semibold text-slate-600">
                        {people.length === 0 ? "暂无研发成员" : "没有匹配的成员"}
                      </div>
                      <div className="mx-auto mt-1 max-w-sm text-xs leading-5 text-slate-400">
                        {people.length === 0
                          ? "后端当前没有人员数据。创建成员后，任务分配和人员负载会使用真实接口数据。"
                          : "当前筛选条件下没有可显示的成员。"}
                      </div>
                      {loadError && (
                        <div className="mx-auto mt-3 max-w-md rounded-md border border-amber-100 bg-amber-50 px-3 py-2 text-xs text-amber-700">
                          {loadError}
                        </div>
                      )}
                      <div className="mt-4 flex items-center justify-center gap-2">
                        {people.length === 0 && canManagePeople ? (
                          <button
                            type="button"
                            onClick={() => setCreating(true)}
                            className="inline-flex items-center gap-1.5 rounded-md bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white transition-all hover:bg-indigo-700 active:scale-[0.98]"
                          >
                            <Plus className="h-3.5 w-3.5" />
                            新增成员
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
                            className="text-xs font-medium text-indigo-600 hover:underline"
                          >
                            重置筛选
                          </button>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                ) : (
                  pagedPeople.map((p) => {
                    const cfg = PERSON_STATUS_CONFIG[p.status] ?? PERSON_STATUS_CONFIG["active"];
                    return (
                      <tr
                        key={p.id}
                        className="group transition-colors duration-150 hover:bg-slate-50/60"
                      >
                        <td className="px-6 py-3.5">
                          <div className="flex items-center gap-3">
                            <PersonAvatar name={p.name} />
                            <div className="min-w-0">
                              <div className="text-sm font-medium text-slate-900">{p.name}</div>
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
                                {p.username ?? p.email ?? "已绑定"}
                              </div>
                              <div className="mt-0.5 text-[11px] text-emerald-600">已绑定</div>
                            </div>
                          ) : (
                            <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-700">
                              未绑定
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3.5 text-sm text-slate-700">{p.position}</td>
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
                            <span className={cn("h-1.5 w-1.5 rounded-full", cfg.dot)} />
                            {cfg.label}
                          </span>
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
                                    {scoreCfg.label}
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
                            <div className="flex items-center justify-end gap-1 opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-within:opacity-100">
                              <button
                                type="button"
                                onClick={() => setEditing(p)}
                                className="rounded-md p-1.5 text-slate-400 transition-all duration-150 hover:bg-indigo-50 hover:text-indigo-600 active:scale-90"
                                aria-label={`编辑 ${p.name}`}
                                title="编辑"
                              >
                                <Pencil className="h-3.5 w-3.5" />
                              </button>
                              <button
                                type="button"
                                onClick={() => setDeleteTarget(p)}
                                className="rounded-md p-1.5 text-slate-400 transition-all duration-150 hover:bg-red-50 hover:text-red-600 active:scale-90"
                                aria-label={`删除 ${p.name}`}
                                title="删除"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
                            </div>
                          ) : (
                            <span className="flex justify-end text-xs text-slate-300">只读</span>
                          )}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
            {filtered.length > 0 && (
              <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 px-6 py-3">
                <div className="text-xs tabular-nums text-slate-400">
                  显示 {firstItem}-{lastItem}
                  <span className="mx-1 text-slate-300">/</span>
                  {filtered.length} 人
                </div>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => setPage((current) => Math.max(1, current - 1))}
                    disabled={safePage === 1}
                    className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-slate-200 bg-white text-slate-500 transition-all duration-150 hover:border-indigo-200 hover:bg-indigo-50 hover:text-indigo-600 disabled:cursor-not-allowed disabled:opacity-35 disabled:hover:border-slate-200 disabled:hover:bg-white disabled:hover:text-slate-500"
                    aria-label="上一页"
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
                        className={cn(
                          "h-8 min-w-8 rounded-md border px-2 text-xs font-semibold tabular-nums transition-all duration-150 active:scale-95",
                          safePage === pageNumber
                            ? "border-indigo-200 bg-indigo-50 text-indigo-700 shadow-[0_6px_14px_rgba(79,70,229,0.1)] ring-1 ring-indigo-100"
                            : "border-slate-200 bg-white text-slate-500 hover:border-indigo-200 hover:bg-indigo-50 hover:text-indigo-600",
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
                    className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-slate-200 bg-white text-slate-500 transition-all duration-150 hover:border-indigo-200 hover:bg-indigo-50 hover:text-indigo-600 disabled:cursor-not-allowed disabled:opacity-35 disabled:hover:border-slate-200 disabled:hover:bg-white disabled:hover:text-slate-500"
                    aria-label="下一页"
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
          canManageDepartments={canManagePeople}
          onSave={handleSave}
          onClose={() => {
            setEditing(null);
            setCreating(false);
          }}
        />
      )}
      {canManagePeople && deleteTarget && (
        <ConfirmDeleteDialog
          person={deleteTarget}
          onConfirm={handleDelete}
          onCancel={() => setDeleteTarget(null)}
        />
      )}
    </div>
  );
}

export default RDPeopleManagementPage;
