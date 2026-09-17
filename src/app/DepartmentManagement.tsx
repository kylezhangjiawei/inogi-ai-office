import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Building2, CheckCircle2, Layers3, Pencil, Plus, RefreshCw, Search, Trash2, Users } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "./auth";
import { PermissionGuard } from "./components/PermissionGuard";
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
import { cn } from "./components/ui/utils";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./components/ui/select";
import { Switch } from "./components/ui/switch";
import { Textarea } from "./components/ui/textarea";
import { authFetch } from "./lib/authSession";
import {
  clearPendingDepartmentChange,
  publishDepartmentChange,
} from "./lib/departmentDirectory";

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
const TABLE_HEADER_CLASS = "px-4 py-3 text-xs font-semibold text-slate-600 whitespace-nowrap";
const TABLE_CELL_CLASS = "px-5 py-4 align-middle text-sm text-slate-700";
const SELECT_TRIGGER_CLASS = "h-10 rounded-xl border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700 outline-none transition-colors focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary";

function SelectControl({
  value,
  onValueChange,
  options,
  className,
  id,
  ariaLabel,
}: {
  value: string;
  onValueChange: (value: string) => void;
  options: Array<{ label: string; value: string }>;
  className?: string;
  id?: string;
  ariaLabel: string;
}) {
  return (
    <Select value={value} onValueChange={onValueChange}>
      <SelectTrigger id={id} className={cn(SELECT_TRIGGER_CLASS, className)} aria-label={ariaLabel}>
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

async function apiSaveDepartment(
  payload: DepartmentFormData,
  previousName?: string,
): Promise<Department> {
  const res = await authFetch("/api/departments", {
    method: "POST",
    body: JSON.stringify({ ...payload, previousName }),
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
type FormErrors = Partial<Record<"name" | "code" | "category", string>>;

export function DepartmentManagement() {
  const { refreshUser } = useAuth();
  const [departments, setDepartments] = useState<Department[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [keyword, setKeyword] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("ALL");
  const [page, setPage] = useState(1);

  const [dialogMode, setDialogMode] = useState<DialogMode>(null);
  const [selectedDepartment, setSelectedDepartment] = useState<Department | null>(null);
  const [form, setForm] = useState<DepartmentFormData>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [formErrors, setFormErrors] = useState<FormErrors>({});
  const [dialogError, setDialogError] = useState("");
  const dialogTriggerRef = useRef<HTMLButtonElement | null>(null);

  const loadDepartments = useCallback(async () => {
    setLoading(true);
    setLoadError("");
    try {
      const items = await apiListDepartments();
      setDepartments(items);
    } catch (err) {
      const message = err instanceof Error ? err.message : "部门数据加载失败";
      setLoadError(message);
      toast.error(message);
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
  const safePage = Math.min(page, totalPages);
  const pagedDepartments = filteredDepartments.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);
  const enabledCount = departments.filter((department) => department.enabled).length;
  const userCount = departments.reduce((sum, department) => sum + department.userCount, 0);
  const hasActiveFilters = Boolean(keyword.trim()) || categoryFilter !== "ALL";

  useEffect(() => {
    if (page !== safePage) setPage(safePage);
  }, [page, safePage]);

  function openCreate(trigger?: HTMLButtonElement | null) {
    dialogTriggerRef.current = trigger ?? null;
    setSelectedDepartment(null);
    setForm({ ...EMPTY_FORM, sortOrder: (departments.length + 1) * 10 });
    setFormErrors({});
    setDialogError("");
    setDialogMode("create");
  }

  function openEdit(department: Department, trigger?: HTMLButtonElement | null) {
    dialogTriggerRef.current = trigger ?? null;
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
    setFormErrors({});
    setDialogError("");
    setDialogMode("edit");
  }

  function openDelete(department: Department, trigger?: HTMLButtonElement | null) {
    dialogTriggerRef.current = trigger ?? null;
    setSelectedDepartment(department);
    setDialogError("");
    setDialogMode("deleteConfirm");
  }

  function closeDialog() {
    setDialogMode(null);
    setSelectedDepartment(null);
    setFormErrors({});
    setDialogError("");
  }

  async function handleSave() {
    const nextErrors: FormErrors = {};
    if (!form.name.trim()) nextErrors.name = "请输入部门名称。";
    if (!form.code.trim()) nextErrors.code = "请输入部门编码。";
    if (!form.category.trim()) nextErrors.category = "请输入部门分类。";
    setFormErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) {
      const firstInvalidId = nextErrors.name
        ? "department-name"
        : nextErrors.code
          ? "department-code"
          : "department-category";
      document.getElementById(firstInvalidId)?.focus();
      return;
    }

    setDialogError("");
    setSaving(true);
    try {
      const saved = await apiSaveDepartment(form, selectedDepartment?.name);
      const previous = selectedDepartment;
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
      if (
        previous &&
        (previous.name !== saved.name || previous.code !== saved.code)
      ) {
        const change = {
          id: saved.id,
          previousName: previous.name,
          name: saved.name,
          previousCode: previous.code,
          code: saved.code,
        };
        publishDepartmentChange(change);
        clearPendingDepartmentChange(change);
        void refreshUser().catch(() => undefined);
      }
      toast.success(form.id ? "部门已更新" : "部门已创建");
      closeDialog();
      void loadDepartments();
    } catch (err) {
      const message = err instanceof Error ? err.message : "保存失败";
      setDialogError(message);
      toast.error(message);
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
    setDialogError("");
    setSaving(true);
    try {
      await apiDeleteDepartment(selectedDepartment.id);
      setDepartments((prev) => prev.filter((item) => item.id !== selectedDepartment.id));
      toast.success("部门已删除");
      closeDialog();
    } catch (err) {
      const message = err instanceof Error ? err.message : "删除失败";
      setDialogError(message);
      toast.error(message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="horizon-theme hz-page">
      <div className="hz-page-inner space-y-3">
        <HorizonPageHeader
          Icon={Building2}
          eyebrow="SYSTEM GOVERNANCE · ORGANIZATION"
          title="部门管理"
          description="维护公司部门主数据，为用户归属、权限治理与跨模块协同提供统一组织目录。"
          meta={(
            <>
              <span>组织目录</span>
              <span aria-hidden="true">·</span>
              <span className="tabular-nums">{loading ? "正在同步" : `${departments.length} 个部门`}</span>
            </>
          )}
          actions={(
            <>
              <Button type="button" variant="outline" onClick={() => void loadDepartments()} disabled={loading}>
                <RefreshCw className={cn("size-4", loading && "animate-spin motion-reduce:animate-none")} aria-hidden="true" />
                {loading ? "读取中…" : "刷新"}
              </Button>
              <PermissionGuard permission="department:create">
                <Button type="button" className="hz-primary-action" onClick={(event) => openCreate(event.currentTarget)}>
                  <Plus className="size-4" aria-hidden="true" />
                  新建部门
                </Button>
              </PermissionGuard>
            </>
          )}
        />

        <HorizonMetricGrid className="!grid-cols-2 xl:!grid-cols-4">
          <HorizonMetric Icon={Building2} label="部门总数" value={loading && departments.length === 0 ? "—" : departments.length} note="组织目录主数据" tone="brand" />
          <HorizonMetric Icon={CheckCircle2} label="启用部门" value={loading && departments.length === 0 ? "—" : enabledCount} note={`${Math.max(0, departments.length - enabledCount)} 个已停用`} tone={enabledCount > 0 ? "success" : "neutral"} />
          <HorizonMetric Icon={Users} label="已归属用户" value={loading && departments.length === 0 ? "—" : userCount} note="跨部门账号归属合计" tone="brand" />
          <HorizonMetric Icon={Layers3} label="业务分类" value={loading && departments.length === 0 ? "—" : categories.length} note="用于筛选与治理分组" tone="neutral" />
        </HorizonMetricGrid>

        <section className="hz-surface min-w-0 overflow-hidden" aria-label="部门目录工作台">
          <HorizonSectionHeader
            Icon={Building2}
            title="部门目录"
            description="检索部门、负责人和业务分类，并维护状态与基础信息。"
            trailing={<span className="text-xs text-slate-500">显示 <span className="tabular-nums font-semibold text-slate-700">{filteredDepartments.length}</span> / {departments.length} 条</span>}
          />

          <div className="grid gap-3 border-b border-slate-200 p-4 sm:grid-cols-[minmax(0,1fr)_200px_auto] sm:items-end">
            <div className="min-w-0">
              <Label htmlFor="department-search" className="mb-1.5 block text-xs font-semibold text-slate-700">搜索部门</Label>
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
                <Input
                  id="department-search"
                  className="pl-9"
                  value={keyword}
                  onChange={(event) => setKeyword(event.target.value)}
                  placeholder="部门、编码、负责人"
                />
              </div>
            </div>
            <div>
              <Label htmlFor="department-category-filter" className="mb-1.5 block text-xs font-semibold text-slate-700">业务分类</Label>
              <SelectControl
                id="department-category-filter"
                ariaLabel="筛选部门业务分类"
                value={categoryFilter}
                onValueChange={setCategoryFilter}
                options={[
                  { label: "全部分类", value: "ALL" },
                  ...categories.map((category) => ({ label: category, value: category })),
                ]}
                className="w-full"
              />
            </div>
            <Button
              type="button"
              variant="outline"
              onClick={() => { setKeyword(""); setCategoryFilter("ALL"); }}
              disabled={!hasActiveFilters}
            >
              清除筛选
            </Button>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full min-w-[1040px] table-fixed text-left">
              <caption className="sr-only">部门名称、分类、负责人、用户数量、排序、状态及可用操作</caption>
              <colgroup>
                <col className="w-[360px]" />
                <col className="w-[150px]" />
                <col className="w-[150px]" />
                <col className="w-[100px]" />
                <col className="w-[90px]" />
                <col className="w-[110px]" />
                <col className="w-[130px]" />
              </colgroup>
              <thead className="bg-slate-50/90">
                <tr>
                  {["部门", "分类", "负责人", "用户数", "排序", "状态", "操作"].map((col) => (
                    <th key={col} scope="col" className={cn(TABLE_HEADER_CLASS, col === "操作" && "text-right")}>
                      {col}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {loading && departments.length === 0 ? (
                  Array.from({ length: 4 }, (_, index) => (
                    <tr key={index} aria-hidden="true">
                      <td colSpan={7} className="px-4 py-4"><div className="h-10 rounded-lg bg-slate-100" /></td>
                    </tr>
                  ))
                ) : pagedDepartments.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="p-0">
                      <HorizonEmptyState
                        Icon={hasActiveFilters ? Search : Building2}
                        title={hasActiveFilters ? "没有匹配的部门" : loadError ? "部门目录加载失败" : "尚未建立部门目录"}
                        description={hasActiveFilters ? "调整检索条件或清除筛选后重试。" : loadError ? loadError : "新建首个部门，为账号和权限建立组织归属。"}
                        action={hasActiveFilters ? (
                          <Button type="button" variant="outline" onClick={() => { setKeyword(""); setCategoryFilter("ALL"); }}>清除筛选</Button>
                        ) : loadError ? (
                          <Button type="button" variant="outline" onClick={() => void loadDepartments()}><RefreshCw className="size-4" aria-hidden="true" />重新读取</Button>
                        ) : (
                          <PermissionGuard permission="department:create">
                            <Button type="button" className="hz-primary-action" onClick={(event) => openCreate(event.currentTarget)}><Plus className="size-4" aria-hidden="true" />新建部门</Button>
                          </PermissionGuard>
                        )}
                      />
                    </td>
                  </tr>
                ) : (
                  pagedDepartments.map((department) => (
                    <tr key={department.id} className="hover:bg-accent/35">
                      <td className={TABLE_CELL_CLASS}>
                        <div className="flex min-w-0 items-start gap-3">
                          <span className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-xl bg-blue-50 text-primary" aria-hidden="true">
                            <Building2 className="size-[18px]" />
                          </span>
                          <div className="min-w-0">
                            <div className="truncate font-semibold text-slate-800">{department.name}</div>
                            <div className="mt-0.5 truncate font-mono text-xs text-slate-500">{department.code}</div>
                            {department.description ? <div className="mt-1 line-clamp-1 max-w-[300px] text-pretty text-xs leading-5 text-slate-500">{department.description}</div> : null}
                          </div>
                        </div>
                      </td>
                      <td className={TABLE_CELL_CLASS}><div className="truncate">{department.category}</div></td>
                      <td className={TABLE_CELL_CLASS}><div className="truncate">{department.manager || "—"}</div></td>
                      <td className={cn(TABLE_CELL_CLASS, "tabular-nums")}>{department.userCount}</td>
                      <td className={cn(TABLE_CELL_CLASS, "tabular-nums")}>{department.sortOrder}</td>
                      <td className={TABLE_CELL_CLASS}>
                        <PermissionGuard
                          anyOf={["department:edit", "rd-people:manage"]}
                          fallback={(
                            <span
                              className={cn(
                                "inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-semibold",
                                department.enabled
                                  ? "border-green-200 bg-green-50 text-green-700"
                                  : "border-slate-200 bg-slate-100 text-slate-600",
                              )}
                              aria-label={`部门状态：${department.enabled ? "启用" : "停用"}`}
                            >
                              {department.enabled ? "启用" : "停用"}
                            </span>
                          )}
                        >
                          <Button variant="unstyled"
                            type="button"
                            className={cn(
                              "inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary",
                              department.enabled
                                ? "border-green-200 bg-green-50 text-green-700 hover:bg-green-100"
                                : "border-slate-200 bg-slate-100 text-slate-600 hover:bg-slate-200",
                            )}
                            onClick={() => void handleToggleStatus(department)}
                            aria-label={`${department.enabled ? "停用" : "启用"}部门 ${department.name}`}
                          >
                            {department.enabled ? "启用" : "停用"}
                          </Button>
                        </PermissionGuard>
                      </td>
                      <td className={cn(TABLE_CELL_CLASS, "text-right")}>
                        <div className="flex justify-end gap-1">
                          <PermissionGuard permission="department:edit">
                            <Button type="button" variant="ghost" size="icon" onClick={(event) => openEdit(department, event.currentTarget)} aria-label={`编辑部门 ${department.name}`} title="编辑部门">
                              <Pencil className="size-4" aria-hidden="true" />
                            </Button>
                          </PermissionGuard>
                          <PermissionGuard permission="department:delete">
                            <Button type="button" variant="ghost" size="icon" className="text-red-600 hover:bg-red-50 hover:text-red-700" onClick={(event) => openDelete(department, event.currentTarget)} aria-label={`删除部门 ${department.name}`} title="删除部门">
                              <Trash2 className="size-4" aria-hidden="true" />
                            </Button>
                          </PermissionGuard>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          <div className="flex flex-col gap-3 border-t border-slate-200 px-4 py-3 text-sm text-slate-500 sm:flex-row sm:items-center sm:justify-between">
            <div>共 <span className="tabular-nums font-semibold text-slate-700">{filteredDepartments.length}</span> 条，第 <span className="tabular-nums">{safePage} / {totalPages}</span> 页</div>
            <div className="flex gap-2">
              <Button type="button" variant="outline" size="sm" onClick={() => setPage(Math.max(1, safePage - 1))} disabled={safePage === 1}>上一页</Button>
              <Button type="button" variant="outline" size="sm" onClick={() => setPage(Math.min(totalPages, safePage + 1))} disabled={safePage === totalPages}>下一页</Button>
            </div>
          </div>
        </section>
      </div>

      <Dialog
        open={dialogMode === "create" || dialogMode === "edit"}
        onOpenChange={(open) => { if (!open && !saving) closeDialog(); }}
      >
        <DialogContent
          className="horizon-portal max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-xl"
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            const trigger = dialogTriggerRef.current;
            dialogTriggerRef.current = null;
            if (trigger?.isConnected) trigger.focus();
          }}
        >
          <form onSubmit={(event) => { event.preventDefault(); void handleSave(); }} className="space-y-5">
            <DialogHeader>
              <DialogTitle className="text-balance text-slate-900">{dialogMode === "edit" ? "编辑部门" : "新建部门"}</DialogTitle>
              <DialogDescription className="text-pretty">维护部门名称、组织编码、业务分类与负责人信息。</DialogDescription>
            </DialogHeader>

            {dialogError ? <p role="alert" className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{dialogError}</p> : null}

            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <Label htmlFor="department-name" className="mb-1.5 block text-sm font-semibold text-slate-700">部门名称 <span className="text-red-600">*</span></Label>
                <Input
                  id="department-name"
                  autoFocus
                  value={form.name}
                  onChange={(event) => { setForm((current) => ({ ...current, name: event.target.value })); if (formErrors.name) setFormErrors((current) => ({ ...current, name: undefined })); }}
                  aria-invalid={Boolean(formErrors.name)}
                  aria-describedby={formErrors.name ? "department-name-error" : undefined}
                />
                {formErrors.name ? <p id="department-name-error" role="alert" className="mt-1.5 text-xs font-medium text-red-600">{formErrors.name}</p> : null}
              </div>
              <div>
                <Label htmlFor="department-code" className="mb-1.5 block text-sm font-semibold text-slate-700">部门编码 <span className="text-red-600">*</span></Label>
                <Input
                  id="department-code"
                  className="uppercase disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-500"
                  value={form.code}
                  onChange={(event) => { setForm((current) => ({ ...current, code: event.target.value })); if (formErrors.code) setFormErrors((current) => ({ ...current, code: undefined })); }}
                  placeholder="IT_SYSTEM"
                  disabled={dialogMode === "edit"}
                  aria-invalid={Boolean(formErrors.code)}
                  aria-describedby={formErrors.code ? "department-code-error" : dialogMode === "edit" ? "department-code-help" : undefined}
                />
                {formErrors.code ? <p id="department-code-error" role="alert" className="mt-1.5 text-xs font-medium text-red-600">{formErrors.code}</p> : null}
                {dialogMode === "edit" ? <p id="department-code-help" className="mt-1.5 text-xs text-slate-500">部门编码用于跨模块关联，创建后不可修改。</p> : null}
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <Label htmlFor="department-category" className="mb-1.5 block text-sm font-semibold text-slate-700">业务分类 <span className="text-red-600">*</span></Label>
                <Input
                  id="department-category"
                  value={form.category}
                  onChange={(event) => { setForm((current) => ({ ...current, category: event.target.value })); if (formErrors.category) setFormErrors((current) => ({ ...current, category: undefined })); }}
                  placeholder="法务系统"
                  aria-invalid={Boolean(formErrors.category)}
                  aria-describedby={formErrors.category ? "department-category-error" : undefined}
                />
                {formErrors.category ? <p id="department-category-error" role="alert" className="mt-1.5 text-xs font-medium text-red-600">{formErrors.category}</p> : null}
              </div>
              <div>
                <Label htmlFor="department-manager" className="mb-1.5 block text-sm font-semibold text-slate-700">负责人</Label>
                <Input id="department-manager" value={form.manager} onChange={(event) => setForm((current) => ({ ...current, manager: event.target.value }))} />
              </div>
            </div>

            <div>
              <Label htmlFor="department-description" className="mb-1.5 block text-sm font-semibold text-slate-700">职责说明</Label>
              <Textarea id="department-description" rows={3} value={form.description} onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))} />
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <Label htmlFor="department-sort-order" className="mb-1.5 block text-sm font-semibold text-slate-700">排序</Label>
                <Input id="department-sort-order" type="number" min={0} value={form.sortOrder} onChange={(event) => setForm((current) => ({ ...current, sortOrder: Number(event.target.value) || 0 }))} />
              </div>
              <div>
                <span className="mb-1.5 block text-sm font-semibold text-slate-700">状态</span>
                <div className="flex h-10 items-center justify-between rounded-xl border border-slate-200 px-3">
                  <Label htmlFor="department-enabled" className="text-sm text-slate-700">{form.enabled ? "启用部门" : "停用部门"}</Label>
                  <Switch id="department-enabled" checked={form.enabled} onCheckedChange={(checked) => setForm((current) => ({ ...current, enabled: checked }))} aria-label="启用部门" />
                </div>
              </div>
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={closeDialog} disabled={saving}>取消</Button>
              <Button type="submit" className="hz-primary-action" disabled={saving}>{saving ? "保存中…" : "保存部门"}</Button>
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
          }}
        >
          <AlertDialogHeader>
            <AlertDialogTitle className="text-balance text-slate-900">确认删除部门？</AlertDialogTitle>
            <AlertDialogDescription className="text-pretty leading-6">
              即将删除部门“{selectedDepartment?.name ?? "当前部门"}”。此操作不可恢复。
            </AlertDialogDescription>
          </AlertDialogHeader>
          {(selectedDepartment?.userCount ?? 0) > 0 ? (
            <p role="alert" className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
              该部门下仍有 <span className="tabular-nums font-semibold">{selectedDepartment?.userCount}</span> 名用户，请先调整用户归属后再删除。
            </p>
          ) : null}
          {dialogError ? <p role="alert" className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{dialogError}</p> : null}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={saving}>保留部门</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 text-white hover:bg-red-700 focus:ring-red-600"
              disabled={saving || (selectedDepartment?.userCount ?? 0) > 0}
              onClick={(event) => { event.preventDefault(); void handleDelete(); }}
            >
              {saving ? "删除中…" : "确认删除"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
