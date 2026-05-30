import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ChevronRight,
  Edit3,
  Eye,
  EyeOff,
  FileText,
  FolderOpen,
  Folder,
  MousePointerClick,
  RefreshCw,
  Search,
  Trash2,
  Plus,
  Minus,
  Layers,
} from "lucide-react";
import { toast } from "sonner";

import { cn } from "./components/ui/utils";
import { Button } from "./components/ui/button";
import { Input } from "./components/ui/input";
import { Textarea } from "./components/ui/textarea";
import { Label } from "./components/ui/label";
import { Badge } from "./components/ui/badge";
import { Checkbox } from "./components/ui/checkbox";
import { Separator } from "./components/ui/separator";
import { Tooltip, TooltipContent, TooltipTrigger } from "./components/ui/tooltip";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "./components/ui/dialog";
import {
  PermissionCatalogItem,
  SavePermissionCatalogItemPayload,
  permissionCatalogApi,
} from "./lib/permissionCatalogApi";

type DialogMode = "create" | "edit" | "delete" | null;

type RouteTreeBranch = {
  key: string;
  label: string;
  items: PermissionCatalogItem[];
};

type RouteTreeRoot = {
  label: string;
  items: PermissionCatalogItem[];
  branches: RouteTreeBranch[];
};

const emptyForm: SavePermissionCatalogItemPayload = {
  code: "",
  label: "",
  description: "",
  groupLabel: "",
  type: "page",
  routePath: "",
  enabled: true,
  navHidden: false,
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

function splitGroupLabel(groupLabel: string) {
  const parts = groupLabel
    .split(/[·>／\/|]/)
    .map((part) => part.trim())
    .filter(Boolean);
  return {
    root: parts[0] || "未分组",
    branch: parts.slice(1).join(" · ") || "默认分组",
  };
}

function buildRouteTree(items: PermissionCatalogItem[]): RouteTreeRoot[] {
  const roots = new Map<string, RouteTreeRoot>();

  for (const item of items) {
    const group = splitGroupLabel(item.groupLabel);
    const root = roots.get(group.root) ?? { label: group.root, items: [], branches: [] };
    root.items.push(item);

    let branch = root.branches.find((candidate) => candidate.label === group.branch);
    if (!branch) {
      branch = { key: `${group.root}::${group.branch}`, label: group.branch, items: [] };
      root.branches.push(branch);
    }
    branch.items.push(item);
    roots.set(group.root, root);
  }

  return Array.from(roots.values())
    .map((root) => ({
      ...root,
      items: root.items.slice().sort((a, b) => a.sortOrder - b.sortOrder),
      branches: root.branches
        .map((branch) => ({ ...branch, items: branch.items.slice().sort((a, b) => a.sortOrder - b.sortOrder) }))
        .sort((a, b) => a.label.localeCompare(b.label, "zh-CN")),
    }))
    .sort((a, b) => {
      const left = Math.min(...a.items.map((item) => item.sortOrder));
      const right = Math.min(...b.items.map((item) => item.sortOrder));
      return left - right || a.label.localeCompare(b.label, "zh-CN");
    });
}

export function RouteManagementPage() {
  const [items, setItems] = useState<PermissionCatalogItem[]>([]);
  const [keyword, setKeyword] = useState("");
  const [typeFilter, setTypeFilter] = useState<"all" | "page" | "action">("all");
  const [navFilter, setNavFilter] = useState<"all" | "visible" | "hidden">("all");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [dialogMode, setDialogMode] = useState<DialogMode>(null);
  const [selected, setSelected] = useState<PermissionCatalogItem | null>(null);
  const [form, setForm] = useState<SavePermissionCatalogItemPayload>(emptyForm);
  const [expandedRoots, setExpandedRoots] = useState<Set<string>>(new Set());
  const [expandedBranches, setExpandedBranches] = useState<Set<string>>(new Set());

  const groupOptions = useMemo(
    () => Array.from(new Set(items.map((item) => item.groupLabel))).sort((a, b) => a.localeCompare(b, "zh-CN")),
    [items],
  );

  const filteredItems = useMemo(() => {
    const normalized = keyword.trim().toLowerCase();
    return items.filter((item) => {
      const typeMatched = typeFilter === "all" || item.type === typeFilter;
      const navMatched =
        navFilter === "all" ||
        (navFilter === "visible" && !item.navHidden) ||
        (navFilter === "hidden" && item.navHidden);
      const keywordMatched =
        !normalized ||
        item.code.toLowerCase().includes(normalized) ||
        item.label.toLowerCase().includes(normalized) ||
        item.groupLabel.toLowerCase().includes(normalized) ||
        item.routePath.toLowerCase().includes(normalized);
      return typeMatched && navMatched && keywordMatched;
    });
  }, [items, keyword, typeFilter, navFilter]);

  const routeTree = useMemo(() => buildRouteTree(filteredItems), [filteredItems]);

  const isFiltering = keyword.trim() !== "" || typeFilter !== "all" || navFilter !== "all";

  useEffect(() => {
    if (isFiltering) {
      const roots = new Set<string>();
      const branches = new Set<string>();
      for (const root of routeTree) {
        roots.add(root.label);
        for (const branch of root.branches) branches.add(branch.key);
      }
      setExpandedRoots(roots);
      setExpandedBranches(branches);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [keyword, typeFilter, navFilter]);

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

  function toggleRoot(rootLabel: string) {
    setExpandedRoots((prev) => {
      const next = new Set(prev);
      if (next.has(rootLabel)) next.delete(rootLabel);
      else next.add(rootLabel);
      return next;
    });
  }

  function toggleBranch(branchKey: string) {
    setExpandedBranches((prev) => {
      const next = new Set(prev);
      if (next.has(branchKey)) next.delete(branchKey);
      else next.add(branchKey);
      return next;
    });
  }

  function expandAll() {
    const roots = new Set<string>();
    const branches = new Set<string>();
    for (const root of routeTree) {
      roots.add(root.label);
      for (const branch of root.branches) branches.add(branch.key);
    }
    setExpandedRoots(roots);
    setExpandedBranches(branches);
  }

  function collapseAll() {
    setExpandedRoots(new Set());
    setExpandedBranches(new Set());
  }

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
      navHidden: item.navHidden,
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

  async function handleToggleNavHidden(item: PermissionCatalogItem) {
    setTogglingId(item.id);
    try {
      await permissionCatalogApi.saveItem({
        id: item.id,
        code: item.code,
        label: item.label,
        description: item.description,
        groupLabel: item.groupLabel,
        type: item.type,
        routePath: item.routePath,
        enabled: item.enabled,
        navHidden: !item.navHidden,
        sortOrder: item.sortOrder,
      });
      toast.success(item.navHidden ? `「${item.label}」已设为导航显示` : `「${item.label}」已设为导航隐藏`);
      setItems((prev) => prev.map((i) => (i.id === item.id ? { ...i, navHidden: !item.navHidden } : i)));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "操作失败");
    } finally {
      setTogglingId(null);
    }
  }

  const hiddenCount = items.filter((i) => i.type === "page" && i.navHidden).length;
  const visibleCount = items.filter((i) => i.type === "page" && !i.navHidden).length;
  const allExpanded = routeTree.length > 0 && routeTree.every((root) => expandedRoots.has(root.label));

  return (
    <div className="space-y-5 animate-rd-fade-in">
      {/* ── Header ───────────────────────────────────────────────────── */}
      <section className="material-card overflow-hidden">
        {/* top accent line */}
        <div className="h-0.5 bg-primary" />
        <div className="flex flex-col gap-5 p-6 xl:flex-row xl:items-center xl:justify-between md:p-8">
          <div>
            <span className="material-chip bg-indigo-50 text-indigo-700 text-xs tracking-wide">Route Permission Catalog</span>
            <h2 className="mt-3 text-2xl font-bold tracking-tight text-slate-950">页面路由管理</h2>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-500">
              维护页面访问权限和按钮操作权限。角色权限矩阵会实时从这里读取。
            </p>
            <p className="mt-1 text-xs text-slate-400 leading-5">
              <strong className="font-medium text-slate-600">导航显示</strong>：页面出现在侧边栏中；
              <strong className="font-medium text-slate-600">导航隐藏</strong>：页面可正常访问，但不出现在导航栏（可通过链接直接进入）。隐藏页面仍然在角色权限中显示，可以为角色授权。
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3 shrink-0">
            {/* Stats */}
            <div className="flex items-center gap-1 rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5">
              <Eye className="h-3.5 w-3.5 text-emerald-500 shrink-0" />
              <span className="text-xs text-slate-500">导航显示</span>
              <span className="ml-1 text-sm font-bold text-slate-800">{visibleCount}</span>
              <Separator orientation="vertical" className="mx-2 h-3.5" />
              <EyeOff className="h-3.5 w-3.5 text-slate-400 shrink-0" />
              <span className="text-xs text-slate-500">导航隐藏</span>
              <span className="ml-1 text-sm font-bold text-slate-800">{hiddenCount}</span>
            </div>
            {/*<Button*/}
            {/*  variant="outline"*/}
            {/*  size="sm"*/}
            {/*  onClick={() => void loadItems()}*/}
            {/*  disabled={loading}*/}
            {/*  className="gap-1.5"*/}
            {/*>*/}
            {/*  <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />*/}
            {/*  刷新*/}
            {/*</Button>*/}
            <Button size="sm" onClick={openCreate} className="gap-1.5">
              <Plus className="h-3.5 w-3.5" />
              新增权限
            </Button>
          </div>
        </div>
      </section>

      {/* ── Tree Card ────────────────────────────────────────────────── */}
      <section className="material-card overflow-hidden">
        {/* Filter bar */}
        <div className="flex flex-col gap-3 border-b border-slate-100 bg-slate-50/60 px-5 py-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex flex-wrap gap-2.5 items-center">
            <div className="relative w-64">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
              <Input
                className="pl-9 h-8 text-sm"
                value={keyword}
                onChange={(e) => setKeyword(e.target.value)}
                placeholder="搜索编码、名称、分组、路由"
              />
            </div>
            <Select value={typeFilter} onValueChange={(v) => setTypeFilter(v as typeof typeFilter)}>
              <SelectTrigger size="sm" className="w-32 h-8 text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">全部类型</SelectItem>
                <SelectItem value="page">页面权限</SelectItem>
                <SelectItem value="action">按钮权限</SelectItem>
              </SelectContent>
            </Select>
            <Select value={navFilter} onValueChange={(v) => setNavFilter(v as typeof navFilter)}>
              <SelectTrigger size="sm" className="w-36 h-8 text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">全部导航状态</SelectItem>
                <SelectItem value="visible">导航显示</SelectItem>
                <SelectItem value="hidden">导航隐藏</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center gap-2.5 shrink-0">
            <Badge variant="secondary" className="text-xs px-2.5 py-1 font-medium">
              {filteredItems.length} 项权限
            </Badge>
            {routeTree.length > 0 && (
              <Button
                variant="outline"
                size="sm"
                className="h-7 gap-1 text-xs px-2.5"
                onClick={allExpanded ? collapseAll : expandAll}
              >
                {allExpanded ? (
                  <><Minus className="h-3 w-3" />折叠全部</>
                ) : (
                  <><Layers className="h-3 w-3" />展开全部</>
                )}
              </Button>
            )}
          </div>
        </div>

        {/* Tree content */}
        {routeTree.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-3 py-16 text-slate-400">
            {loading ? (
              <RefreshCw className="h-6 w-6 animate-spin text-slate-300" />
            ) : (
              <FolderOpen className="h-8 w-8 text-slate-200" />
            )}
            <span className="text-sm">{loading ? "加载中…" : "暂无匹配的权限项"}</span>
          </div>
        ) : (
          <div className="divide-y divide-slate-100">
            {routeTree.map((root) => {
              const pageCount = root.items.filter((item) => item.type === "page").length;
              const actionCount = root.items.length - pageCount;
              const hiddenPages = root.items.filter((item) => item.type === "page" && item.navHidden).length;
              const isRootExpanded = expandedRoots.has(root.label);

              return (
                <div key={root.label}>
                  {/* Root accordion header */}
                  <button
                    type="button"
                    onClick={() => toggleRoot(root.label)}
                    className="group flex w-full cursor-pointer items-center gap-3 px-5 py-3.5 text-left transition-colors duration-150 hover:bg-indigo-50/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-200"
                  >
                    <ChevronRight
                      className={cn(
                        "h-4 w-4 shrink-0 text-slate-400 transition-transform duration-250 ease-out",
                        isRootExpanded && "rotate-90 text-indigo-500",
                      )}
                    />
                    <span
                      className={cn(
                        "flex h-7 w-7 shrink-0 items-center justify-center rounded-lg transition-colors duration-150",
                        isRootExpanded
                          ? "bg-indigo-100 text-indigo-600 ring-1 ring-indigo-200"
                          : "bg-slate-100 text-slate-500 ring-1 ring-slate-200 group-hover:bg-indigo-50 group-hover:text-indigo-500",
                      )}
                    >
                      {isRootExpanded ? <FolderOpen className="h-3.5 w-3.5" /> : <Folder className="h-3.5 w-3.5" />}
                    </span>
                    <span className="flex-1 text-sm font-semibold text-slate-800">{root.label}</span>
                    <span className="hidden items-center gap-2.5 text-xs text-slate-400 sm:flex">
                      <span>{root.branches.length} 分组</span>
                      <span className="h-3 w-px bg-slate-200" />
                      <span className="flex items-center gap-1">
                        <FileText className="h-3 w-3" />{pageCount}
                      </span>
                      <span className="h-3 w-px bg-slate-200" />
                      <span className="flex items-center gap-1">
                        <MousePointerClick className="h-3 w-3" />{actionCount}
                      </span>
                      {hiddenPages > 0 && (
                        <>
                          <span className="h-3 w-px bg-slate-200" />
                          <span className="flex items-center gap-1 text-amber-500">
                            <EyeOff className="h-3 w-3" />{hiddenPages}
                          </span>
                        </>
                      )}
                    </span>
                  </button>

                  {/* Animated branches wrapper */}
                  <div
                    className={cn(
                      "grid transition-all duration-300 ease-out",
                      isRootExpanded ? "grid-rows-[1fr]" : "grid-rows-[0fr]",
                    )}
                  >
                    <div className="overflow-hidden border-t border-slate-100 bg-slate-50/40">
                      {root.branches.map((branch) => {
                        const branchPageCount = branch.items.filter((item) => item.type === "page").length;
                        const isBranchExpanded = expandedBranches.has(branch.key);

                        return (
                          <div key={branch.key} className="border-b border-slate-100/80 last:border-b-0">
                            {/* Branch header */}
                            <button
                              type="button"
                              onClick={() => toggleBranch(branch.key)}
                              className="group/branch flex w-full cursor-pointer items-center gap-2 px-5 py-2.5 pl-14 text-left transition-colors duration-150 hover:bg-indigo-50/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-200"
                            >
                              <ChevronRight
                                className={cn(
                                  "h-3.5 w-3.5 shrink-0 text-slate-300 transition-transform duration-200 ease-out group-hover/branch:text-slate-400",
                                  isBranchExpanded && "rotate-90 text-indigo-400! group-hover/branch:text-indigo-400!",
                                )}
                              />
                              <span className={cn(
                                "flex-1 text-xs font-semibold tracking-wide transition-colors duration-150",
                                isBranchExpanded ? "text-indigo-600" : "text-slate-600",
                              )}>
                                {branch.label}
                              </span>
                              <span className="text-[11px] text-slate-400">
                                {branch.items.length} 项 · {branchPageCount} 页面 · {branch.items.length - branchPageCount} 按钮
                              </span>
                            </button>

                            {/* Animated items wrapper */}
                            <div
                              className={cn(
                                "grid transition-all duration-250 ease-out",
                                isBranchExpanded ? "grid-rows-[1fr]" : "grid-rows-[0fr]",
                              )}
                            >
                              <div className="overflow-hidden divide-y divide-slate-100/60 bg-white">
                                {branch.items.map((item) => (
                                  <div
                                    key={item.id}
                                    className="group/item flex items-start gap-3 px-5 py-3 pl-20 transition-colors duration-150 hover:bg-slate-50/80"
                                  >
                                    {/* Type badge */}
                                    {item.type === "page" ? (
                                      <Badge className="mt-0.5 shrink-0 bg-indigo-50 text-indigo-600 border-indigo-100 text-[11px] px-1.5 py-0 h-5 font-medium gap-1 hover:bg-indigo-50">
                                        <FileText className="h-2.5 w-2.5" />
                                        页面
                                      </Badge>
                                    ) : (
                                      <Badge className="mt-0.5 shrink-0 bg-emerald-50 text-emerald-600 border-emerald-100 text-[11px] px-1.5 py-0 h-5 font-medium gap-1 hover:bg-emerald-50">
                                        <MousePointerClick className="h-2.5 w-2.5" />
                                        按钮
                                      </Badge>
                                    )}

                                    {/* Content */}
                                    <div className="min-w-0 flex-1">
                                      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                                        <span className="text-sm font-medium text-slate-800">{item.label}</span>
                                        <span className="font-mono text-[11px] text-slate-400 bg-slate-100 px-1.5 py-0.5 rounded">{item.code}</span>
                                        {item.routePath && (
                                          <span className="font-mono text-[11px] text-indigo-500 bg-indigo-50 px-1.5 py-0.5 rounded">{item.routePath}</span>
                                        )}
                                      </div>
                                      <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                                        <Badge
                                          variant="outline"
                                          className={cn(
                                            "text-[11px] px-1.5 py-0 h-4.5 font-medium border",
                                            item.enabled
                                              ? "bg-emerald-50 text-emerald-600 border-emerald-100"
                                              : "bg-slate-100 text-slate-400 border-slate-200",
                                          )}
                                        >
                                          {item.enabled ? "启用" : "停用"}
                                        </Badge>
                                        {item.type === "page" && (
                                          <Tooltip>
                                            <TooltipTrigger asChild>
                                              <button
                                                type="button"
                                                disabled={togglingId === item.id}
                                                onClick={() => void handleToggleNavHidden(item)}
                                                className={cn(
                                                  "inline-flex cursor-pointer items-center gap-1 rounded border px-1.5 text-[11px] font-medium transition-all duration-150 h-[18px]",
                                                  "hover:scale-105 active:scale-95",
                                                  item.navHidden
                                                    ? "bg-amber-50 text-amber-600 border-amber-100 hover:bg-amber-100"
                                                    : "bg-emerald-50 text-emerald-600 border-emerald-100 hover:bg-emerald-100",
                                                  togglingId === item.id && "cursor-not-allowed opacity-50",
                                                )}
                                              >
                                                {item.navHidden ? (
                                                  <><EyeOff className="h-2.5 w-2.5" />导航隐藏</>
                                                ) : (
                                                  <><Eye className="h-2.5 w-2.5" />导航显示</>
                                                )}
                                              </button>
                                            </TooltipTrigger>
                                            <TooltipContent side="top" sideOffset={4}>
                                              {item.navHidden ? "点击设为导航显示" : "点击设为导航隐藏"}
                                            </TooltipContent>
                                          </Tooltip>
                                        )}
                                        {item.description && (
                                          <span className="text-[11px] text-slate-400 line-clamp-1 max-w-xs">{item.description}</span>
                                        )}
                                      </div>
                                      <div className="mt-1 text-[10px] text-slate-300">更新 {formatDate(item.updatedAt)}</div>
                                    </div>

                                    {/* Actions — fade in on hover */}
                                    <div className="flex shrink-0 gap-1 opacity-0 transition-opacity duration-150 group-hover/item:opacity-100">
                                      <Tooltip>
                                        <TooltipTrigger asChild>
                                          <Button
                                            variant="ghost"
                                            size="icon"
                                            className="h-7 w-7 text-slate-500 hover:text-indigo-600 hover:bg-indigo-50"
                                            onClick={() => openEdit(item)}
                                          >
                                            <Edit3 className="h-3.5 w-3.5" />
                                          </Button>
                                        </TooltipTrigger>
                                        <TooltipContent side="top" sideOffset={4}>编辑</TooltipContent>
                                      </Tooltip>
                                      <Tooltip>
                                        <TooltipTrigger asChild>
                                          <Button
                                            variant="ghost"
                                            size="icon"
                                            className="h-7 w-7 text-slate-400 hover:text-red-500 hover:bg-red-50"
                                            onClick={() => openDelete(item)}
                                          >
                                            <Trash2 className="h-3.5 w-3.5" />
                                          </Button>
                                        </TooltipTrigger>
                                        <TooltipContent side="top" sideOffset={4}>删除</TooltipContent>
                                      </Tooltip>
                                    </div>
                                  </div>
                                ))}
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* ── Create / Edit dialog ─────────────────────────────────────── */}
      <Dialog open={dialogMode === "create" || dialogMode === "edit"} onOpenChange={(open) => !open && closeDialog()}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{dialogMode === "edit" ? "编辑权限目录" : "新增权限目录"}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 py-1 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="perm-code">权限编码</Label>
              <Input
                id="perm-code"
                value={form.code}
                onChange={(e) => setForm((c) => ({ ...c, code: e.target.value }))}
                placeholder="如 page:route-management"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="perm-label">显示名称</Label>
              <Input
                id="perm-label"
                value={form.label}
                onChange={(e) => setForm((c) => ({ ...c, label: e.target.value }))}
                placeholder="如 页面路由管理"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="perm-group">权限分组</Label>
              <Input
                id="perm-group"
                list="permission-group-options"
                value={form.groupLabel}
                onChange={(e) => setForm((c) => ({ ...c, groupLabel: e.target.value }))}
                placeholder="如 页面访问 · 系统管理"
              />
              <datalist id="permission-group-options">
                {groupOptions.map((group) => <option key={group} value={group} />)}
              </datalist>
            </div>
            <div className="space-y-1.5">
              <Label>类型</Label>
              <Select
                value={form.type}
                onValueChange={(v) => setForm((c) => ({ ...c, type: v as "page" | "action" }))}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="page">页面权限</SelectItem>
                  <SelectItem value="action">按钮权限</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="perm-path">路由路径</Label>
              <Input
                id="perm-path"
                value={form.routePath ?? ""}
                onChange={(e) => setForm((c) => ({ ...c, routePath: e.target.value }))}
                placeholder="页面权限填写，如 /roles"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="perm-sort">排序</Label>
              <Input
                id="perm-sort"
                type="number"
                min={0}
                value={form.sortOrder}
                onChange={(e) => setForm((c) => ({ ...c, sortOrder: Number(e.target.value) || 0 }))}
              />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="perm-desc">描述</Label>
              <Textarea
                id="perm-desc"
                value={form.description ?? ""}
                onChange={(e) => setForm((c) => ({ ...c, description: e.target.value }))}
                placeholder="说明该权限控制的页面或按钮"
                className="min-h-[72px]"
              />
            </div>
            <div className="flex flex-col gap-3 sm:col-span-2 sm:flex-row">
              <label className="flex flex-1 cursor-pointer items-center gap-3 rounded-md border border-slate-200 bg-slate-50 p-3 transition-colors hover:bg-slate-100/60">
                <Checkbox
                  checked={form.enabled}
                  onCheckedChange={(checked) => setForm((c) => ({ ...c, enabled: !!checked }))}
                />
                <div>
                  <div className="text-sm font-medium text-slate-700">启用该权限</div>
                  <div className="text-xs text-slate-500">停用后角色权限矩阵不显示此项</div>
                </div>
              </label>
              {form.type === "page" && (
                <label className="flex flex-1 cursor-pointer items-center gap-3 rounded-md border border-slate-200 bg-slate-50 p-3 transition-colors hover:bg-slate-100/60">
                  <Checkbox
                    checked={!form.navHidden}
                    onCheckedChange={(checked) => setForm((c) => ({ ...c, navHidden: !checked }))}
                  />
                  <div>
                    <div className="text-sm font-medium text-slate-700">显示在导航栏</div>
                    <div className="text-xs text-slate-500">取消勾选则页面可访问但不出现在侧边栏</div>
                  </div>
                </label>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={closeDialog} disabled={saving}>取消</Button>
            <Button onClick={() => void handleSave()} disabled={saving}>
              {saving && <RefreshCw className="h-3.5 w-3.5 animate-spin" />}
              保存
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Delete dialog ────────────────────────────────────────────── */}
      <Dialog open={dialogMode === "delete"} onOpenChange={(open) => !open && closeDialog()}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>删除权限目录</DialogTitle>
          </DialogHeader>
          <p className="text-sm leading-6 text-slate-600">
            确认删除「<strong className="text-slate-800">{selected?.label}</strong>」？
            已分配给角色的权限编码不会自动清理，但后续权限矩阵不再显示该项。
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={closeDialog} disabled={saving}>取消</Button>
            <Button variant="destructive" onClick={() => void handleDelete()} disabled={saving}>
              {saving && <RefreshCw className="h-3.5 w-3.5 animate-spin" />}
              删除
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
