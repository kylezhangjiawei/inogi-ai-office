import React, { useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowRight,
  ChevronLeft,
  ChevronRight,
  Pencil,
  Plus,
  Search,
  Trash2,
  X,
} from "lucide-react";
import { cn } from "./components/ui/utils";

// ─── Types ───────────────────────────────────────────────────────────────────

export type PersonStatus = "active" | "on_leave" | "resigned";

export type Person = {
  id: string;
  name: string;
  position: string;
  department: string;
  email?: string;
  phone?: string;
  status: PersonStatus;
  max_tasks: number;
  joined_at?: string;
};

// ─── Demo seed data ──────────────────────────────────────────────────────────

const INITIAL_PEOPLE: Person[] = [
  { id: "p1", name: "王磊", position: "硬件测试工程师", department: "硬件组", email: "wanglei@inogi.com", status: "active", max_tasks: 8, joined_at: "2024-03-12" },
  { id: "p2", name: "陈静", position: "质检员", department: "质量组", email: "chenjing@inogi.com", status: "active", max_tasks: 8, joined_at: "2024-06-01" },
  { id: "p3", name: "李静", position: "法规工程师", department: "法规组", email: "lijing@inogi.com", status: "on_leave", max_tasks: 8, joined_at: "2023-11-20" },
  { id: "p4", name: "张越", position: "嵌入式工程师", department: "软件组", email: "zhangyue@inogi.com", status: "active", max_tasks: 8, joined_at: "2024-08-15" },
  { id: "p5", name: "赵强", position: "工艺工程师", department: "工艺组", email: "zhaoqiang@inogi.com", status: "active", max_tasks: 8, joined_at: "2023-09-08" },
  { id: "p6", name: "刘华", position: "项目工程师", department: "项目组", email: "liuhua@inogi.com", status: "active", max_tasks: 8, joined_at: "2024-01-10" },
  { id: "p7", name: "李明", position: "嵌入式工程师", department: "软件组", email: "liming@inogi.com", status: "active", max_tasks: 8, joined_at: "2024-05-22" },
];

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
    name: "",
    position: "",
    department: "硬件组",
    email: "",
    phone: "",
    status: "active",
    max_tasks: 8,
  };
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
  onSave,
  onClose,
}: {
  person: Person | null;
  onSave: (p: Person) => void;
  onClose: () => void;
}) {
  const isEdit = person !== null;
  const [form, setForm] = useState<Person>(person ?? emptyPerson());
  const [errors, setErrors] = useState<{ name?: string; position?: string }>({});

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const newErrors: typeof errors = {};
    if (!form.name.trim()) newErrors.name = "姓名不能为空";
    if (!form.position.trim()) newErrors.position = "职位不能为空";
    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors);
      return;
    }
    onSave(form);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 px-4 backdrop-blur-sm animate-rd-fade-in"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md overflow-hidden rounded-2xl bg-white shadow-[0_24px_60px_rgba(15,23,42,0.2)] animate-rd-scale-in"
        onClick={(e) => e.stopPropagation()}
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
          <div className="grid grid-cols-2 gap-3">
            <Field label="姓名" required error={errors.name}>
              <input
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                className={cn(
                  "w-full rounded-md border bg-white px-3 py-2 text-sm text-slate-900 outline-none transition-all focus:border-blue-300 focus:ring-2 focus:ring-blue-100",
                  errors.name ? "border-red-300" : "border-slate-200",
                )}
                placeholder="例: 王磊"
                autoFocus
              />
            </Field>
            <Field label="职位" required error={errors.position}>
              <input
                value={form.position}
                onChange={(e) => setForm((f) => ({ ...f, position: e.target.value }))}
                className={cn(
                  "w-full rounded-md border bg-white px-3 py-2 text-sm text-slate-900 outline-none transition-all focus:border-blue-300 focus:ring-2 focus:ring-blue-100",
                  errors.position ? "border-red-300" : "border-slate-200",
                )}
                placeholder="硬件测试工程师"
              />
            </Field>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Field label="所属组">
              <select
                value={form.department}
                onChange={(e) => setForm((f) => ({ ...f, department: e.target.value }))}
                className="w-full cursor-pointer rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none transition-all focus:border-blue-300 focus:ring-2 focus:ring-blue-100"
              >
                {DEPARTMENTS.map((d) => (
                  <option key={d} value={d}>
                    {d}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="状态">
              <select
                value={form.status}
                onChange={(e) =>
                  setForm((f) => ({ ...f, status: e.target.value as PersonStatus }))
                }
                className="w-full cursor-pointer rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none transition-all focus:border-blue-300 focus:ring-2 focus:ring-blue-100"
              >
                <option value="active">在岗</option>
                <option value="on_leave">请假中</option>
                <option value="resigned">已离职</option>
              </select>
            </Field>
          </div>

          <Field label="邮箱">
            <input
              type="email"
              value={form.email ?? ""}
              onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
              className="w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none transition-all focus:border-blue-300 focus:ring-2 focus:ring-blue-100"
              placeholder="user@inogi.com"
            />
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label="联系电话">
              <input
                value={form.phone ?? ""}
                onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
                className="w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none transition-all focus:border-blue-300 focus:ring-2 focus:ring-blue-100"
                placeholder="13800000000"
              />
            </Field>
            <Field label="任务上限">
              <input
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
                className="w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none transition-all focus:border-blue-300 focus:ring-2 focus:ring-blue-100"
              />
            </Field>
          </div>

          <footer className="flex items-center justify-end gap-2 border-t border-slate-100 pt-4">
            <button
              type="button"
              onClick={onClose}
              className="rounded-md border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 transition-all duration-150 hover:bg-slate-50 active:scale-[0.98]"
            >
              取消
            </button>
            <button
              type="submit"
              className="inline-flex items-center gap-1.5 rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow-[0_8px_18px_rgba(37,99,235,0.2)] transition-all duration-150 hover:bg-blue-700 active:scale-[0.98]"
            >
              {isEdit ? "保存修改" : "创建成员"}
              <ArrowRight className="h-3.5 w-3.5" />
            </button>
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
      onClick={onCancel}
    >
      <div
        className="w-full max-w-sm overflow-hidden rounded-2xl bg-white shadow-[0_24px_60px_rgba(15,23,42,0.2)] animate-rd-scale-in"
        onClick={(e) => e.stopPropagation()}
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
  const [people, setPeople] = useState<Person[]>(initialPeople);
  const [keyword, setKeyword] = useState("");
  const [statusFilter, setStatusFilter] = useState<PersonStatus | "all">("all");
  const [deptFilter, setDeptFilter] = useState<string>("all");
  const [editing, setEditing] = useState<Person | null>(null);
  const [creating, setCreating] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Person | null>(null);
  const [page, setPage] = useState(1);

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

  const handleSave = (p: Person) => {
    if (editing) {
      setPeople((prev) => prev.map((x) => (x.id === p.id ? p : x)));
      setEditing(null);
    } else {
      setPeople((prev) => [...prev, { ...p, id: `p${Date.now()}` }]);
      setCreating(false);
    }
    setPage(1);
  };

  const handleDelete = () => {
    if (deleteTarget) {
      setPeople((prev) => prev.filter((p) => p.id !== deleteTarget.id));
      setDeleteTarget(null);
      setPage(1);
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
        <button
          type="button"
          onClick={() => setCreating(true)}
          className="inline-flex items-center gap-1.5 rounded-md bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white shadow-[0_8px_18px_rgba(37,99,235,0.2)] transition-all duration-150 hover:-translate-y-0.5 hover:bg-blue-700 hover:shadow-[0_12px_24px_rgba(37,99,235,0.22)] active:scale-[0.98]"
        >
          <Plus className="h-3.5 w-3.5" />
          新增成员
        </button>
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
            <div className="flex min-w-[260px] flex-1 items-center gap-2 rounded-md border border-slate-200 bg-white px-2.5 py-1.5 transition-all focus-within:border-blue-300 focus-within:ring-2 focus-within:ring-blue-100">
              <Search className="h-3.5 w-3.5 text-slate-400" />
              <input
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
                      ? "border-blue-200 bg-blue-50 text-blue-700 shadow-[0_6px_14px_rgba(37,99,235,0.08)] ring-1 ring-blue-100"
                      : "text-slate-500 hover:bg-slate-100 hover:text-slate-700",
                  )}
                >
                  {s === "all" ? "全部" : PERSON_STATUS_CONFIG[s].label}
                </button>
              ))}
            </div>

            <select
              value={deptFilter}
              onChange={(e) => {
                setDeptFilter(e.target.value);
                setPage(1);
              }}
              className="cursor-pointer rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-600 outline-none transition-all focus:border-blue-300 focus:ring-2 focus:ring-blue-100"
            >
              <option value="all">全部组</option>
              {DEPARTMENTS.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>

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
                  <th className="px-4 py-3 text-left">职位</th>
                  <th className="px-4 py-3 text-left">组</th>
                  <th className="px-4 py-3 text-left">状态</th>
                  <th className="px-4 py-3 text-left">入职日期</th>
                  <th className="px-4 py-3 text-right">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filtered.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-6 py-16 text-center">
                      <div className="text-sm font-medium text-slate-400">没有匹配的成员</div>
                      <button
                        type="button"
                        onClick={() => {
                          setKeyword("");
                          setStatusFilter("all");
                          setDeptFilter("all");
                          setPage(1);
                        }}
                        className="mt-3 text-xs font-medium text-blue-600 hover:underline"
                      >
                        重置筛选
                      </button>
                    </td>
                  </tr>
                ) : (
                  pagedPeople.map((p) => {
                    const cfg = PERSON_STATUS_CONFIG[p.status];
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
                        <td className="px-4 py-3.5 text-xs tabular-nums text-slate-500">
                          {p.joined_at ?? "—"}
                        </td>
                        <td className="px-4 py-3.5">
                          <div className="flex items-center justify-end gap-1 opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-within:opacity-100">
                            <button
                              type="button"
                              onClick={() => setEditing(p)}
                              className="rounded-md p-1.5 text-slate-400 transition-all duration-150 hover:bg-blue-50 hover:text-blue-600 active:scale-90"
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
                    className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-slate-200 bg-white text-slate-500 transition-all duration-150 hover:border-blue-200 hover:bg-blue-50 hover:text-blue-600 disabled:cursor-not-allowed disabled:opacity-35 disabled:hover:border-slate-200 disabled:hover:bg-white disabled:hover:text-slate-500"
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
                            ? "border-blue-200 bg-blue-50 text-blue-700 shadow-[0_6px_14px_rgba(37,99,235,0.1)] ring-1 ring-blue-100"
                            : "border-slate-200 bg-white text-slate-500 hover:border-blue-200 hover:bg-blue-50 hover:text-blue-600",
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
                    className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-slate-200 bg-white text-slate-500 transition-all duration-150 hover:border-blue-200 hover:bg-blue-50 hover:text-blue-600 disabled:cursor-not-allowed disabled:opacity-35 disabled:hover:border-slate-200 disabled:hover:bg-white disabled:hover:text-slate-500"
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
      {(editing || creating) && (
        <PersonFormModal
          person={editing}
          onSave={handleSave}
          onClose={() => {
            setEditing(null);
            setCreating(false);
          }}
        />
      )}
      {deleteTarget && (
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
