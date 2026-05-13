import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Building2, Pencil, Plus, RefreshCw, Search, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { PermissionGuard } from "./components/PermissionGuard";
import { cn } from "./components/ui/utils";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./components/ui/select";
import { authFetch } from "./lib/authSession";

type Department = {
  id: string;
  code: string;
  name: string;
  category: string;
  manager: string;
  description: string;
  sortOrder: number;
  enabled: boolean;
  userCount: number;
  createdAt: string;
  updatedAt: string;
};

type DepartmentFormData = {
  id?: string;
  code: string;
  name: string;
  category: string;
  manager: string;
  description: string;
  sortOrder: number;
  enabled: boolean;
};

const EMPTY_FORM: DepartmentFormData = {
  code: "",
  name: "",
  category: "",
  manager: "",
  description: "",
  sortOrder: 100,
  enabled: true,
};

const PAGE_SIZE = 10;
const TABLE_HEADER_CLASS = "px-5 py-3 text-xs font-semibold uppercase tracking-[0.14em] text-slate-500 whitespace-nowrap";
const TABLE_CELL_CLASS = "px-5 py-4 align-middle text-sm text-slate-700";
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
  return (
    <Select value={value} onValueChange={onValueChange}>
      <SelectTrigger className={cn(SELECT_TRIGGER_CLASS, className)}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent className="rounded-xl border border-slate-200 bg-white p-1 shadow-lg">
        {options.map((option) => (
          <SelectItem key={option.value} value={option.value} className="rounded-lg py-2 pl-3 pr-9 text-sm text-slate-700">
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

async function apiListDepartments(): Promise<Department[]> {
  const res = await authFetch("/api/departments");
  if (!res.ok) throw new Error("获取部门列表失败");
  return res.json() as Promise<Department[]>;
}

async function apiSaveDepartment(payload: DepartmentFormData): Promise<Department> {
  const res = await authFetch("/api/departments", {
    method: "POST",
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { message?: string | string[] };
    const msg = Array.isArray(err.message) ? err.message.join(", ") : (err.message ?? "保存部门失败");
    throw new Error(msg);
  }
  return res.json() as Promise<Department>;
}

async function apiUpdateDepartmentStatus(id: string, enabled: boolean): Promise<Department> {
  const res = await authFetch(`/api/departments/${id}/status`, {
    method: "PATCH",
    body: JSON.stringify({ enabled }),
  });
  if (!res.ok) throw new Error("部门状态更新失败");
  return res.json() as Promise<Department>;
}

async function apiDeleteDepartment(id: string): Promise<void> {
  const res = await authFetch(`/api/departments/${id}`, { method: "DELETE" });
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { message?: string };
    throw new Error(err.message ?? "删除部门失败");
  }
}

type DialogMode = "create" | "edit" | "deleteConfirm" | null;

export function DepartmentManagement() {
  const [departments, setDepartments] = useState<Department[]>([]);
  const [loading, setLoading] = useState(true);
  const [keyword, setKeyword] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("ALL");
  const [page, setPage] = useState(1);

  const [dialogMode, setDialogMode] = useState<DialogMode>(null);
  const [selectedDepartment, setSelectedDepartment] = useState<Department | null>(null);
  const [form, setForm] = useState<DepartmentFormData>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);

  const loadDepartments = useCallback(async () => {
    setLoading(true);
    try {
      setDepartments(await apiListDepartments());
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "部门数据加载失败");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadDepartments();
  }, [loadDepartments]);

  const categories = useMemo(
    () => Array.from(new Set(departments.map((item) => item.category))).filter(Boolean),
    [departments],
  );

  const filteredDepartments = useMemo(
    () =>
      departments.filter((department) => {
        const q = keyword.trim().toLowerCase();
        const matchesKeyword =
          !q ||
          department.name.toLowerCase().includes(q) ||
          department.code.toLowerCase().includes(q) ||
          department.category.toLowerCase().includes(q) ||
          department.manager.toLowerCase().includes(q);
        const matchesCategory = categoryFilter === "ALL" || department.category === categoryFilter;
        return matchesKeyword && matchesCategory;
      }),
    [departments, keyword, categoryFilter],
  );

  useEffect(() => {
    setPage(1);
  }, [keyword, categoryFilter]);

  const totalPages = Math.max(1, Math.ceil(filteredDepartments.length / PAGE_SIZE));
  const pagedDepartments = filteredDepartments.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const enabledCount = departments.filter((department) => department.enabled).length;
  const userCount = departments.reduce((sum, department) => sum + department.userCount, 0);

  function openCreate() {
    setSelectedDepartment(null);
    setForm({ ...EMPTY_FORM, sortOrder: (departments.length + 1) * 10 });
    setDialogMode("create");
  }

  function openEdit(department: Department) {
    setSelectedDepartment(department);
    setForm({
      id: department.id,
      code: department.code,
      name: department.name,
      category: department.category,
      manager: department.manager,
      description: department.description,
      sortOrder: department.sortOrder,
      enabled: department.enabled,
    });
    setDialogMode("edit");
  }

  function openDelete(department: Department) {
    setSelectedDepartment(department);
    setDialogMode("deleteConfirm");
  }

  function closeDialog() {
    setDialogMode(null);
    setSelectedDepartment(null);
  }

  async function handleSave() {
    if (!form.name.trim() || !form.code.trim() || !form.category.trim()) {
      toast.error("部门名称、编码、分类为必填项");
      return;
    }

    setSaving(true);
    try {
      const saved = await apiSaveDepartment(form);
      const next = { ...saved, userCount: selectedDepartment?.userCount ?? 0 };
      setDepartments((prev) => {
        const idx = prev.findIndex((item) => item.id === saved.id);
        if (idx >= 0) {
          const copy = [...prev];
          copy[idx] = next;
          return copy;
        }
        return [...prev, next].sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));
      });
      toast.success(form.id ? "部门已更新" : "部门已创建");
      closeDialog();
      void loadDepartments();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "保存失败");
    } finally {
      setSaving(false);
    }
  }

  async function handleToggleStatus(department: Department) {
    try {
      const updated = await apiUpdateDepartmentStatus(department.id, !department.enabled);
      setDepartments((prev) =>
        prev.map((item) =>
          item.id === updated.id ? { ...item, ...updated, userCount: department.userCount } : item,
        ),
      );
      toast.success(updated.enabled ? "部门已启用" : "部门已停用");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "操作失败");
    }
  }

  async function handleDelete() {
    if (!selectedDepartment) return;
    setSaving(true);
    try {
      await apiDeleteDepartment(selectedDepartment.id);
      setDepartments((prev) => prev.filter((item) => item.id !== selectedDepartment.id));
      toast.success("部门已删除");
      closeDialog();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "删除失败");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <section className="material-card p-6 md:p-8">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <span className="material-chip bg-blue-50 text-blue-700">Department Directory</span>
            <h2 className="mt-3 text-[2rem] font-bold tracking-tight text-slate-900">部门管理</h2>
            <p className="mt-2 max-w-3xl text-sm leading-7 text-slate-600">
              维护公司部门主数据，供用户归属、权限治理和系统模块协同使用。默认部门已按当前业务模块生成。
            </p>
          </div>
          <div className="flex gap-2">
            <button className="material-button-secondary w-fit" onClick={() => void loadDepartments()} disabled={loading}>
              <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
              刷新
            </button>
            <PermissionGuard permission="department:create">
              <button className="material-button-primary w-fit" onClick={openCreate}>
                <Plus className="h-4 w-4" />
                新建部门
              </button>
            </PermissionGuard>
          </div>
        </div>
      </section>

      <section className="grid gap-4 md:grid-cols-3">
        {[
          ["部门总数", departments.length],
          ["启用部门", enabledCount],
          ["已归属用户", userCount],
        ].map(([label, value]) => (
          <div key={label} className="material-card p-5">
            <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">{label}</div>
            <div className="mt-3 text-3xl font-bold text-slate-900">{value}</div>
          </div>
        ))}
      </section>

      <section className="material-card p-5 md:p-6">
        <div className="mb-4 flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
          <div className="relative w-full xl:max-w-[420px]">
            <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              className="material-input pl-11"
              value={keyword}
              onChange={(event) => setKeyword(event.target.value)}
              placeholder="搜索部门、编码、负责人..."
            />
          </div>
          <div className="flex flex-wrap items-center gap-3">

            <SelectControl
              value={categoryFilter}
              onValueChange={setCategoryFilter}
              options={[
                { label: "全部分类", value: "ALL" },
                ...categories.map((category) => ({ label: category, value: category })),
              ]}
              className="min-w-[160px]"
            />
          </div>
        </div>

        <div className="overflow-hidden rounded-2xl border border-slate-200">
          <div className="overflow-x-auto">
          <table className="w-full min-w-[1180px] table-fixed text-left">
            <colgroup>
              <col className="w-[420px]" />
              <col className="w-[160px]" />
              <col className="w-[160px]" />
              <col className="w-[110px]" />
              <col className="w-[100px]" />
              <col className="w-[120px]" />
              <col className="w-[150px]" />
            </colgroup>
            <thead className="bg-slate-50/90">
              <tr>
                {["部门", "分类", "负责人", "用户数", "排序", "状态", "操作"].map((col) => (
                  <th key={col} className={cn(TABLE_HEADER_CLASS, col === "操作" && "text-right")}>
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
              ) : pagedDepartments.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-12 text-center text-sm text-slate-400">暂无部门</td>
                </tr>
              ) : (
                pagedDepartments.map((department) => (
                  <tr key={department.id} className="h-[86px] transition hover:bg-blue-50/25">
                    <td className={TABLE_CELL_CLASS}>
                      <div className="flex min-w-0 items-start gap-3">
                        <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-blue-50 text-blue-600">
                          <Building2 className="h-[18px] w-[18px]" />
                        </div>
                        <div className="min-w-0">
                          <div className="truncate font-medium text-slate-800">{department.name}</div>
                          <div className="mt-0.5 truncate text-xs text-slate-400">{department.code}</div>
                          {department.description && (
                            <div className="mt-1 max-w-[330px] truncate text-xs leading-5 text-slate-500">{department.description}</div>
                          )}
                        </div>
                      </div>
                    </td>
                    <td className={TABLE_CELL_CLASS}><div className="truncate">{department.category}</div></td>
                    <td className={TABLE_CELL_CLASS}><div className="truncate">{department.manager || "—"}</div></td>
                    <td className={TABLE_CELL_CLASS}>{department.userCount}</td>
                    <td className={TABLE_CELL_CLASS}>{department.sortOrder}</td>
                    <td className={TABLE_CELL_CLASS}>
                      <button
                        type="button"
                        className={cn(
                          "material-chip",
                          department.enabled ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-500",
                        )}
                        onClick={() => void handleToggleStatus(department)}
                      >
                        {department.enabled ? "启用" : "停用"}
                      </button>
                    </td>
                    <td className={cn(TABLE_CELL_CLASS, "text-right")}>
                      <div className="flex justify-end gap-2">
                        <PermissionGuard permission="department:edit">
                          <ActionIconButton onClick={() => openEdit(department)} title="编辑部门">
                            <Pencil className="h-3.5 w-3.5" />
                          </ActionIconButton>
                        </PermissionGuard>
                        <PermissionGuard permission="department:delete">
                          <ActionIconButton
                            className="hover:border-red-200 hover:bg-red-50"
                            onClick={() => openDelete(department)}
                            title="删除部门"
                          >
                            <Trash2 className="h-3.5 w-3.5 text-red-500" />
                          </ActionIconButton>
                        </PermissionGuard>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
          </div>
        </div>

        <div className="mt-5 flex flex-col gap-3 border-t border-slate-100 pt-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="text-sm text-slate-500">
            共 {filteredDepartments.length} 条，第 {page} / {totalPages} 页
          </div>
          <div className="flex gap-2">
            <button className="material-button-secondary !px-3 !py-2" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1}>
              上一页
            </button>
            <button className="material-button-secondary !px-3 !py-2" onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page === totalPages}>
              下一页
            </button>
          </div>
        </div>
      </section>

      {(dialogMode === "create" || dialogMode === "edit") && (
        <ModalShell
          title={dialogMode === "edit" ? "编辑部门" : "新建部门"}
          maxWidth="max-w-xl"
          footer={
            <>
              <button className="material-button-secondary" onClick={closeDialog} disabled={saving}>取消</button>
              <button className="material-button-primary" onClick={() => void handleSave()} disabled={saving}>
                {saving ? "保存中..." : "保存部门"}
              </button>
            </>
          }
        >
            <div className="space-y-4 pt-1">
              <div className="grid gap-4 md:grid-cols-2">
                <div>
                  <label className="mb-1.5 block text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">部门名称 *</label>
                  <input className="material-input w-full" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
                </div>
                <div>
                  <label className="mb-1.5 block text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">部门编码 *</label>
                  <input className="material-input w-full uppercase" value={form.code} onChange={(e) => setForm((f) => ({ ...f, code: e.target.value }))} placeholder="IT_SYSTEM" />
                </div>
              </div>
              <div className="grid gap-4 md:grid-cols-2">
                <div>
                  <label className="mb-1.5 block text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">分类 *</label>
                  <input className="material-input w-full" value={form.category} onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))} placeholder="法务系统" />
                </div>
                <div>
                  <label className="mb-1.5 block text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">负责人</label>
                  <input className="material-input w-full" value={form.manager} onChange={(e) => setForm((f) => ({ ...f, manager: e.target.value }))} />
                </div>
              </div>
              <div>
                <label className="mb-1.5 block text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">职责说明</label>
                <textarea className="material-input w-full resize-none" rows={3} value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} />
              </div>
              <div className="grid gap-4 md:grid-cols-2">
                <div>
                  <label className="mb-1.5 block text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">排序</label>
                  <input className="material-input w-full" type="number" min={0} value={form.sortOrder} onChange={(e) => setForm((f) => ({ ...f, sortOrder: Number(e.target.value) || 0 }))} />
                </div>
                <div>
                <label className="mb-1.5 block text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">状态</label>
                  <SelectControl
                    value={form.enabled ? "true" : "false"}
                    onValueChange={(value) => setForm((f) => ({ ...f, enabled: value === "true" }))}
                    options={[
                      { label: "启用", value: "true" },
                      { label: "停用", value: "false" },
                    ]}
                    className="w-full"
                  />
                </div>
              </div>
            </div>
        </ModalShell>
      )}

      {dialogMode === "deleteConfirm" && (
        <ModalShell
          title="确认删除部门"
          maxWidth="max-w-md"
          footer={
            <>
              <button className="material-button-secondary" onClick={closeDialog} disabled={saving}>取消</button>
              <button
                className="rounded-xl bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-50"
                onClick={() => void handleDelete()}
                disabled={saving || (selectedDepartment?.userCount ?? 0) > 0}
              >
                {saving ? "删除中..." : "确认删除"}
              </button>
            </>
          }
        >
            <p className="text-sm text-slate-600">
              即将删除部门 <strong>{selectedDepartment?.name}</strong>。
              {(selectedDepartment?.userCount ?? 0) > 0 && (
                <span className="mt-2 block text-red-600">该部门下仍有 {selectedDepartment?.userCount} 名用户，请先调整用户部门后再删除。</span>
              )}
            </p>
        </ModalShell>
      )}
    </div>
  );
}
