import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Dialog, DialogActions, DialogContent, DialogTitle } from "@mui/material";
import { Edit3, Plus, RefreshCw, Search, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "./components/ui/table";
import { cn } from "./components/ui/utils";
import {
  PermissionCatalogItem,
  SavePermissionCatalogItemPayload,
  permissionCatalogApi,
} from "./lib/permissionCatalogApi";

type DialogMode = "create" | "edit" | "delete" | null;

const emptyForm: SavePermissionCatalogItemPayload = {
  code: "",
  label: "",
  description: "",
  groupLabel: "",
  type: "page",
  routePath: "",
  enabled: true,
  sortOrder: 1000,
};

function formatDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

export function RouteManagementPage() {
  const [items, setItems] = useState<PermissionCatalogItem[]>([]);
  const [keyword, setKeyword] = useState("");
  const [typeFilter, setTypeFilter] = useState<"all" | "page" | "action">("all");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [dialogMode, setDialogMode] = useState<DialogMode>(null);
  const [selected, setSelected] = useState<PermissionCatalogItem | null>(null);
  const [form, setForm] = useState<SavePermissionCatalogItemPayload>(emptyForm);

  const groupOptions = useMemo(
    () => Array.from(new Set(items.map((item) => item.groupLabel))).sort((a, b) => a.localeCompare(b, "zh-CN")),
    [items],
  );

  const filteredItems = useMemo(() => {
    const normalized = keyword.trim().toLowerCase();
    return items.filter((item) => {
      const typeMatched = typeFilter === "all" || item.type === typeFilter;
      const keywordMatched =
        !normalized ||
        item.code.toLowerCase().includes(normalized) ||
        item.label.toLowerCase().includes(normalized) ||
        item.groupLabel.toLowerCase().includes(normalized) ||
        item.routePath.toLowerCase().includes(normalized);
      return typeMatched && keywordMatched;
    });
  }, [items, keyword, typeFilter]);

  const loadItems = useCallback(async () => {
    setLoading(true);
    try {
      setItems(await permissionCatalogApi.listItems());
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "页面路由目录加载失败");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadItems();
  }, [loadItems]);

  function openCreate() {
    setSelected(null);
    setForm({
      ...emptyForm,
      groupLabel: groupOptions[0] ?? "页面访问 · 系统管理",
      sortOrder: (items[items.length - 1]?.sortOrder ?? 1000) + 10,
    });
    setDialogMode("create");
  }

  function openEdit(item: PermissionCatalogItem) {
    setSelected(item);
    setForm({
      id: item.id,
      code: item.code,
      label: item.label,
      description: item.description,
      groupLabel: item.groupLabel,
      type: item.type,
      routePath: item.routePath,
      enabled: item.enabled,
      sortOrder: item.sortOrder,
    });
    setDialogMode("edit");
  }

  function openDelete(item: PermissionCatalogItem) {
    setSelected(item);
    setDialogMode("delete");
  }

  function closeDialog() {
    setDialogMode(null);
    setSelected(null);
    setForm(emptyForm);
  }

  async function handleSave() {
    if (!form.code.trim() || !form.label.trim() || !form.groupLabel.trim()) {
      toast.error("请填写权限编码、名称和分组");
      return;
    }
    if (form.type === "page" && !form.routePath?.trim()) {
      toast.error("页面权限需要填写路由路径");
      return;
    }

    setSaving(true);
    try {
      await permissionCatalogApi.saveItem({
        ...form,
        code: form.code.trim(),
        label: form.label.trim(),
        description: form.description?.trim(),
        groupLabel: form.groupLabel.trim(),
        routePath: form.routePath?.trim(),
      });
      toast.success(dialogMode === "edit" ? "权限目录已更新" : "权限目录已新增");
      closeDialog();
      await loadItems();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "保存权限目录失败");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!selected) return;
    setSaving(true);
    try {
      await permissionCatalogApi.deleteItem(selected.id);
      toast.success("权限目录已删除");
      closeDialog();
      await loadItems();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "删除权限目录失败");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      <section className="material-card p-6 md:p-8">
        <div className="flex flex-col gap-5 xl:flex-row xl:items-end xl:justify-between">
          <div>
            <span className="material-chip bg-blue-50 text-blue-700">Route Permission Catalog</span>
            <h2 className="mt-4 text-3xl font-bold tracking-tight text-slate-950">页面路由管理</h2>
            <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-600">
              维护页面访问权限和按钮操作权限。角色权限矩阵会实时从这里读取，不再依赖前端写死的权限配置。
            </p>
          </div>
          <div className="flex flex-wrap gap-3">
            <button className="material-button-secondary" onClick={() => void loadItems()} disabled={loading}>
              <RefreshCw className="h-4 w-4" />
              刷新
            </button>
            <button className="material-button-primary" onClick={openCreate}>
              <Plus className="h-4 w-4" />
              新增权限
            </button>
          </div>
        </div>
      </section>

      <section className="material-card p-5">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="grid gap-3 sm:grid-cols-[320px_160px]">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                className="material-input py-2.5 pl-10"
                value={keyword}
                onChange={(event) => setKeyword(event.target.value)}
                placeholder="搜索编码、名称、分组、路由"
              />
            </div>
            <select className="material-input py-2.5" value={typeFilter} onChange={(event) => setTypeFilter(event.target.value as typeof typeFilter)}>
              <option value="all">全部类型</option>
              <option value="page">页面权限</option>
              <option value="action">按钮权限</option>
            </select>
          </div>
          <span className="material-chip bg-slate-100 text-slate-600">{filteredItems.length} 项权限</span>
        </div>

        <div className="mt-5 overflow-hidden rounded border border-slate-200">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>权限名称</TableHead>
                <TableHead>编码</TableHead>
                <TableHead>分组</TableHead>
                <TableHead>类型</TableHead>
                <TableHead>路由</TableHead>
                <TableHead>排序</TableHead>
                <TableHead>状态</TableHead>
                <TableHead>更新时间</TableHead>
                <TableHead className="text-right">操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredItems.map((item) => (
                <TableRow key={item.id} className="align-top">
                  <TableCell>
                    <div className="font-semibold text-slate-900">{item.label}</div>
                    <div className="mt-1 max-w-[260px] truncate text-xs text-slate-500">{item.description || "无描述"}</div>
                  </TableCell>
                  <TableCell className="font-mono text-xs">{item.code}</TableCell>
                  <TableCell>{item.groupLabel}</TableCell>
                  <TableCell>
                    <span className={cn("material-chip", item.type === "page" ? "bg-blue-50 text-blue-700" : "bg-emerald-50 text-emerald-700")}>
                      {item.type === "page" ? "页面" : "按钮"}
                    </span>
                  </TableCell>
                  <TableCell className="font-mono text-xs text-slate-600">{item.routePath || "-"}</TableCell>
                  <TableCell>{item.sortOrder}</TableCell>
                  <TableCell>
                    <span className={cn("material-chip", item.enabled ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-500")}>
                      {item.enabled ? "启用" : "停用"}
                    </span>
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-xs text-slate-500">{formatDate(item.updatedAt)}</TableCell>
                  <TableCell>
                    <div className="flex justify-end gap-2">
                      <button className="material-button-secondary !px-3 !py-2" onClick={() => openEdit(item)} title="编辑">
                        <Edit3 className="h-4 w-4" />
                      </button>
                      <button className="material-button-secondary !px-3 !py-2 text-red-500 hover:border-red-200 hover:bg-red-50" onClick={() => openDelete(item)} title="删除">
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </section>

      <Dialog open={dialogMode === "create" || dialogMode === "edit"} onClose={closeDialog} maxWidth="md" fullWidth>
        <DialogTitle>{dialogMode === "edit" ? "编辑权限目录" : "新增权限目录"}</DialogTitle>
        <DialogContent>
          <div className="grid gap-4 py-2 md:grid-cols-2">
            <label className="space-y-2">
              <span className="text-sm font-semibold text-slate-700">权限编码</span>
              <input className="material-input" value={form.code} onChange={(event) => setForm((current) => ({ ...current, code: event.target.value }))} placeholder="如 page:route-management" />
            </label>
            <label className="space-y-2">
              <span className="text-sm font-semibold text-slate-700">显示名称</span>
              <input className="material-input" value={form.label} onChange={(event) => setForm((current) => ({ ...current, label: event.target.value }))} placeholder="如 页面路由管理" />
            </label>
            <label className="space-y-2">
              <span className="text-sm font-semibold text-slate-700">权限分组</span>
              <input className="material-input" list="permission-group-options" value={form.groupLabel} onChange={(event) => setForm((current) => ({ ...current, groupLabel: event.target.value }))} placeholder="如 页面访问 · 系统管理" />
              <datalist id="permission-group-options">
                {groupOptions.map((group) => <option key={group} value={group} />)}
              </datalist>
            </label>
            <label className="space-y-2">
              <span className="text-sm font-semibold text-slate-700">类型</span>
              <select className="material-input" value={form.type} onChange={(event) => setForm((current) => ({ ...current, type: event.target.value as "page" | "action" }))}>
                <option value="page">页面权限</option>
                <option value="action">按钮权限</option>
              </select>
            </label>
            <label className="space-y-2">
              <span className="text-sm font-semibold text-slate-700">路由路径</span>
              <input className="material-input" value={form.routePath ?? ""} onChange={(event) => setForm((current) => ({ ...current, routePath: event.target.value }))} placeholder="页面权限填写，如 /roles" />
            </label>
            <label className="space-y-2">
              <span className="text-sm font-semibold text-slate-700">排序</span>
              <input className="material-input" type="number" min={0} value={form.sortOrder} onChange={(event) => setForm((current) => ({ ...current, sortOrder: Number(event.target.value) || 0 }))} />
            </label>
            <label className="space-y-2 md:col-span-2">
              <span className="text-sm font-semibold text-slate-700">描述</span>
              <textarea className="material-input min-h-[96px] resize-none" value={form.description ?? ""} onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))} placeholder="说明该权限控制的页面或按钮" />
            </label>
            <label className="flex items-center gap-3 rounded border border-slate-200 bg-slate-50 p-3">
              <input type="checkbox" checked={form.enabled} onChange={(event) => setForm((current) => ({ ...current, enabled: event.target.checked }))} />
              <span className="text-sm font-semibold text-slate-700">启用该权限</span>
            </label>
          </div>
        </DialogContent>
        <DialogActions>
          <button className="material-button-secondary" onClick={closeDialog} disabled={saving}>取消</button>
          <button className="material-button-primary" onClick={() => void handleSave()} disabled={saving}>保存</button>
        </DialogActions>
      </Dialog>

      <Dialog open={dialogMode === "delete"} onClose={closeDialog} maxWidth="xs" fullWidth>
        <DialogTitle>删除权限目录</DialogTitle>
        <DialogContent>
          <p className="text-sm leading-6 text-slate-600">
            确认删除“{selected?.label}”？已分配给角色的权限编码不会自动从角色中清理，但后续权限矩阵不再显示该项。
          </p>
        </DialogContent>
        <DialogActions>
          <button className="material-button-secondary" onClick={closeDialog} disabled={saving}>取消</button>
          <button className="material-button-primary !bg-red-500 hover:!bg-red-600" onClick={() => void handleDelete()} disabled={saving}>删除</button>
        </DialogActions>
      </Dialog>
    </div>
  );
}
