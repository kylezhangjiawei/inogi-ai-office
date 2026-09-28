import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  ChevronRight,
  Edit3,
  Eye,
  EyeOff,
  FileText,
  Folder,
  FolderOpen,
  GripVertical,
  Layers3,
  Minus,
  MousePointerClick,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";

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
import { Checkbox } from "./components/ui/checkbox";
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
import { Textarea } from "./components/ui/textarea";
import { cn } from "./components/ui/utils";
import {
  PermissionCatalogItem,
  SavePermissionCatalogItemPayload,
  permissionCatalogApi,
} from "./lib/permissionCatalogApi";
import { buildRouteTree, dropRoutePages, moveRoutePages, type RouteOrderTarget } from "./lib/routeCatalogOrder";
import { cacheRoutePaths } from "./lib/routePaths";

type DialogMode = "create" | "edit" | "delete" | null;
type FormField = "code" | "label" | "groupLabel" | "routePath";
type FormErrors = Partial<Record<FormField, string>>;
type DragSource = RouteOrderTarget & { label: string };
type DropTarget = RouteOrderTarget & { placement: "before" | "after" };

const EMPTY_FORM: SavePermissionCatalogItemPayload = {
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

const TABLE_HEADER_CLASS = "px-4 py-3 text-xs font-semibold text-slate-600 whitespace-nowrap";
const TABLE_CELL_CLASS = "px-4 py-3.5 align-top text-sm text-slate-700";

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

function TypeBadge({ type }: { type: PermissionCatalogItem["type"] }) {
  return type === "page" ? (
    <span className="inline-flex items-center gap-1 rounded-full border border-blue-200 bg-blue-50 px-2.5 py-1 text-xs font-semibold text-primary">
      <FileText className="size-3" aria-hidden="true" />页面
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-700">
      <MousePointerClick className="size-3" aria-hidden="true" />按钮
    </span>
  );
}

function MoveButtons({ label, index, count, disabled, onMove }: {
  label: string;
  index: number;
  count: number;
  disabled: boolean;
  onMove: (direction: -1 | 1) => void;
}) {
  return (
    <div className="inline-flex shrink-0 items-center gap-0.5" role="group" aria-label={`调整${label}的位置`}>
      <Button type="button" variant="ghost" size="icon" className="size-8" disabled={disabled || index <= 0}
        aria-label={`上移${label}`} title="上移" onClick={() => onMove(-1)}>
        <ArrowUp className="size-3.5" aria-hidden="true" />
      </Button>
      <Button type="button" variant="ghost" size="icon" className="size-8" disabled={disabled || index < 0 || index >= count - 1}
        aria-label={`下移${label}`} title="下移" onClick={() => onMove(1)}>
        <ArrowDown className="size-3.5" aria-hidden="true" />
      </Button>
    </div>
  );
}

function DragHandle({ label, disabled, onStart, onEnd }: {
  label: string;
  disabled: boolean;
  onStart: (event: React.DragEvent<HTMLButtonElement>) => void;
  onEnd: () => void;
}) {
  return (
    <Button type="button" variant="ghost" size="icon" tabIndex={-1}
      className="size-8 shrink-0 cursor-grab text-slate-400 hover:text-primary active:cursor-grabbing disabled:cursor-not-allowed"
      disabled={disabled} draggable={!disabled} aria-label={`拖动${label}`} aria-describedby="route-order-help"
      title="拖动调整顺序，也可使用上下箭头" onDragStart={onStart} onDragEnd={onEnd}>
      <GripVertical className="pointer-events-none size-4" aria-hidden="true" />
    </Button>
  );
}

function LoadingTable() {
  return (
    <div className="overflow-x-auto" aria-label="正在加载权限目录" aria-busy="true">
      <table className="w-full min-w-[1080px] table-fixed text-left">
        <caption className="sr-only">权限目录正在加载</caption>
        <thead className="bg-slate-50/90">
          <tr>
            {["权限项", "类型", "访问路径", "状态", "导航", "显示顺序", "更新时间", "操作"].map((column) => (
              <th key={column} scope="col" className={TABLE_HEADER_CLASS}>{column}</th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {Array.from({ length: 4 }, (_, index) => (
            <tr key={index} aria-hidden="true">
              <td colSpan={8} className="px-4 py-4"><div className="h-10 rounded-lg bg-slate-100" /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function RouteManagementPage() {
  const [items, setItems] = useState<PermissionCatalogItem[]>([]);
  const [keyword, setKeyword] = useState("");
  const [typeFilter, setTypeFilter] = useState<"all" | "page" | "action">("all");
  const [navFilter, setNavFilter] = useState<"all" | "visible" | "hidden">("all");
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [saving, setSaving] = useState(false);
  const [reordering, setReordering] = useState(false);
  const [orderError, setOrderError] = useState("");
  const [dragSource, setDragSource] = useState<DragSource | null>(null);
  const [dropTarget, setDropTarget] = useState<DropTarget | null>(null);
  const [busyItemIds, setBusyItemIds] = useState<Set<string>>(new Set());
  const [actionError, setActionError] = useState<{ id: string; message: string } | null>(null);
  const [dialogMode, setDialogMode] = useState<DialogMode>(null);
  const [dialogError, setDialogError] = useState("");
  const [formErrors, setFormErrors] = useState<FormErrors>({});
  const [selected, setSelected] = useState<PermissionCatalogItem | null>(null);
  const [form, setForm] = useState<SavePermissionCatalogItemPayload>(EMPTY_FORM);
  const [expandedRoots, setExpandedRoots] = useState<Set<string>>(new Set());
  const [expandedBranches, setExpandedBranches] = useState<Set<string>>(new Set());

  const originalRoutePathRef = useRef("");
  const reorderingRef = useRef(false);
  const dragSourceRef = useRef<DragSource | null>(null);
  const itemsRequestRef = useRef(0);
  const busyItemIdsRef = useRef<Set<string>>(new Set());
  const dialogTriggerRef = useRef<HTMLElement | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const codeInputRef = useRef<HTMLInputElement | null>(null);
  const labelInputRef = useRef<HTMLInputElement | null>(null);
  const groupInputRef = useRef<HTMLInputElement | null>(null);
  const routePathInputRef = useRef<HTMLInputElement | null>(null);

  const groupOptions = useMemo(
    () => Array.from(new Set(items.map((item) => item.groupLabel))).sort((a, b) => a.localeCompare(b, "zh-CN")),
    [items],
  );
  const filteredItems = useMemo(() => {
    const normalized = keyword.trim().toLowerCase();
    return items.filter((item) => {
      const typeMatched = typeFilter === "all" || item.type === typeFilter;
      const navMatched = navFilter === "all" || (navFilter === "visible" && !item.navHidden) || (navFilter === "hidden" && item.navHidden);
      const keywordMatched = !normalized || [item.code, item.label, item.groupLabel, item.routePath, item.description]
        .some((value) => value.toLowerCase().includes(normalized));
      return typeMatched && navMatched && keywordMatched;
    });
  }, [items, keyword, typeFilter, navFilter]);
  const routeTree = useMemo(() => buildRouteTree(filteredItems), [filteredItems]);
  const pageTree = useMemo(() => buildRouteTree(items.filter((item) => item.type === "page")), [items]);
  const partialPageFilter = keyword.trim() !== "" || navFilter !== "all";
  const orderDisabled = partialPageFilter || loading || Boolean(loadError) || saving || reordering || busyItemIds.size > 0 || dialogMode !== null;
  const isFiltering = keyword.trim() !== "" || typeFilter !== "all" || navFilter !== "all";
  const pageCount = items.filter((item) => item.type === "page").length;
  const actionCount = items.length - pageCount;
  const hiddenCount = items.filter((item) => item.type === "page" && item.navHidden).length;
  const visibleCount = pageCount - hiddenCount;
  const enabledCount = items.filter((item) => item.enabled).length;
  const allExpanded = routeTree.length > 0 && routeTree.every((root) => (
    expandedRoots.has(root.label) && root.branches.every((branch) => expandedBranches.has(branch.key))
  ));

  const loadItems = useCallback(async () => {
    const requestId = ++itemsRequestRef.current;
    setLoading(true);
    setLoadError("");
    try {
      const fresh = await permissionCatalogApi.listItems();
      if (requestId !== itemsRequestRef.current) return null;
      setItems(fresh);
      setOrderError("");
      return fresh;
    } catch (error) {
      if (requestId !== itemsRequestRef.current) return null;
      const message = error instanceof Error ? error.message : "页面路由目录加载失败";
      setLoadError(message);
      toast.error(message);
      return null;
    } finally {
      if (requestId === itemsRequestRef.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadItems();
    return () => { itemsRequestRef.current += 1; };
  }, [loadItems]);

  function invalidatePendingLoads() {
    itemsRequestRef.current += 1;
    setLoading(false);
  }

  function beginItemWrite(itemId?: string) {
    if (reorderingRef.current) return false;
    if (itemId && busyItemIdsRef.current.has(itemId)) return false;
    if (itemId) {
      const next = new Set(busyItemIdsRef.current);
      next.add(itemId);
      busyItemIdsRef.current = next;
      setBusyItemIds(next);
    }
    invalidatePendingLoads();
    return true;
  }

  function finishItemWrite(itemId?: string) {
    if (!itemId) return;
    const next = new Set(busyItemIdsRef.current);
    next.delete(itemId);
    busyItemIdsRef.current = next;
    setBusyItemIds(next);
  }

  function toggleRoot(rootLabel: string) {
    setExpandedRoots((current) => {
      const next = new Set(current);
      if (next.has(rootLabel)) next.delete(rootLabel); else next.add(rootLabel);
      return next;
    });
  }

  function toggleBranch(branchKey: string) {
    setExpandedBranches((current) => {
      const next = new Set(current);
      if (next.has(branchKey)) next.delete(branchKey); else next.add(branchKey);
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

  function clearFilters() {
    setKeyword("");
    setTypeFilter("all");
    setNavFilter("all");
  }

  function clearFieldError(field: FormField) {
    setFormErrors((current) => current[field] ? { ...current, [field]: undefined } : current);
    if (dialogError) setDialogError("");
  }

  function openCreate(trigger: HTMLElement) {
    if (reorderingRef.current) return;
    dialogTriggerRef.current = trigger;
    setSelected(null);
    setForm({
      ...EMPTY_FORM,
      groupLabel: groupOptions[0] ?? "页面访问 · 系统管理",
      sortOrder: (items[items.length - 1]?.sortOrder ?? 1000) + 10,
    });
    setFormErrors({});
    setDialogError("");
    originalRoutePathRef.current = "";
    setDialogMode("create");
  }

  function openEdit(item: PermissionCatalogItem, trigger: HTMLElement) {
    if (reorderingRef.current || busyItemIdsRef.current.has(item.id)) return;
    dialogTriggerRef.current = trigger;
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
    setFormErrors({});
    setDialogError("");
    originalRoutePathRef.current = item.routePath ?? "";
    setDialogMode("edit");
  }

  function openDelete(item: PermissionCatalogItem, trigger: HTMLElement) {
    if (reorderingRef.current || item.builtIn || busyItemIdsRef.current.has(item.id)) return;
    dialogTriggerRef.current = trigger;
    setSelected(item);
    setDialogError("");
    setDialogMode("delete");
  }

  function closeDialog() {
    setDialogMode(null);
    setSelected(null);
    setForm(EMPTY_FORM);
    setFormErrors({});
    setDialogError("");
  }

  function validateForm() {
    const errors: FormErrors = {};
    const code = form.code.trim();
    const routePath = form.routePath?.trim() ?? "";
    if (!code) errors.code = "请填写权限编码。";
    else if (items.some((item) => item.id !== form.id && item.code.toLowerCase() === code.toLowerCase())) errors.code = "该权限编码已存在，请使用唯一编码。";
    if (!form.label.trim()) errors.label = "请填写显示名称。";
    if (!form.groupLabel.trim()) errors.groupLabel = "请填写权限分组。";
    if (form.type === "page") {
      if (!routePath) errors.routePath = "页面权限需要填写访问路径。";
      else if (!routePath.startsWith("/")) errors.routePath = "访问路径必须以 / 开头，例如 /rd-sheet。";
      else if (/[\s?#]/.test(routePath)) errors.routePath = "访问路径不能包含空格、? 或 #。";
      else if (routePath.includes("*")) errors.routePath = "访问路径不支持通配符 *。";
      else if (routePath !== "/" && routePath.endsWith("/")) errors.routePath = "访问路径结尾不能有 /。";
      else {
        const clash = items.find((item) => item.id !== form.id && item.type === "page" && item.routePath.trim() === routePath);
        if (clash) errors.routePath = `该路径已被“${clash.label}”（${clash.code}）占用。`;
      }
    }
    return errors;
  }

  function focusFirstInvalidField(errors: FormErrors) {
    const refs: Array<[FormField, React.RefObject<HTMLInputElement | null>]> = [
      ["code", codeInputRef],
      ["label", labelInputRef],
      ["groupLabel", groupInputRef],
      ["routePath", routePathInputRef],
    ];
    const first = refs.find(([field]) => Boolean(errors[field]));
    requestAnimationFrame(() => first?.[1].current?.focus());
  }

  async function handleSave() {
    const errors = validateForm();
    if (Object.keys(errors).length > 0) {
      setFormErrors(errors);
      setDialogError("请检查标记的字段后再保存。");
      focusFirstInvalidField(errors);
      return;
    }
    const mode = dialogMode;
    const nextRoutePath = form.routePath?.trim() ?? "";
    const busyItemId = form.id;
    if (!beginItemWrite(busyItemId)) {
      setDialogError("该权限项正在保存，请稍候再试。");
      return;
    }
    setSaving(true);
    setDialogError("");
    try {
      await permissionCatalogApi.saveItem({
        ...form,
        code: form.code.trim(),
        label: form.label.trim(),
        description: form.description?.trim(),
        groupLabel: form.groupLabel.trim(),
        routePath: nextRoutePath,
      });
      toast.success(mode === "edit" ? "权限目录已更新" : "权限目录已新增");
      if (mode === "edit" && form.type === "page" && nextRoutePath !== originalRoutePathRef.current) {
        toast.info("访问路径已变更，刷新页面后全站生效（导航、页内跳转一并更新）", { duration: 6000 });
      }
      closeDialog();
      const fresh = await loadItems();
      if (fresh) cacheRoutePaths(fresh);
    } catch (error) {
      const message = error instanceof Error ? error.message : "保存权限目录失败";
      setDialogError(message);
      if (message.includes("访问路径")) {
        const nextErrors: FormErrors = { routePath: message };
        setFormErrors((current) => ({ ...current, ...nextErrors }));
        focusFirstInvalidField(nextErrors);
      }
      toast.error(message);
    } finally {
      setSaving(false);
      finishItemWrite(busyItemId);
    }
  }

  async function handleDelete() {
    if (!selected || selected.builtIn) return;
    const busyItemId = selected.id;
    if (!beginItemWrite(busyItemId)) {
      setDialogError("该权限项正在保存，请稍候再试。");
      return;
    }
    setSaving(true);
    setDialogError("");
    try {
      await permissionCatalogApi.deleteItem(selected.id);
      toast.success("权限目录已删除");
      dialogTriggerRef.current = searchInputRef.current;
      closeDialog();
      const fresh = await loadItems();
      if (fresh) cacheRoutePaths(fresh);
    } catch (error) {
      const message = error instanceof Error ? error.message : "删除权限目录失败";
      setDialogError(message);
      toast.error(message);
    } finally {
      setSaving(false);
      finishItemWrite(busyItemId);
    }
  }

  async function handleToggleNavHidden(item: PermissionCatalogItem) {
    if (!beginItemWrite(item.id)) return;
    setActionError(null);
    try {
      const saved = await permissionCatalogApi.saveItem({
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
      toast.success(item.navHidden ? `“${item.label}”已设为导航显示` : `“${item.label}”已设为导航隐藏`);
      setItems((current) => current.map((candidate) => candidate.id === item.id ? { ...candidate, ...saved, builtIn: candidate.builtIn } : candidate));
      const fresh = await loadItems();
      if (fresh) cacheRoutePaths(fresh);
    } catch (error) {
      const message = error instanceof Error ? error.message : "导航状态更新失败";
      setActionError({ id: item.id, message });
      toast.error(message);
    } finally {
      finishItemWrite(item.id);
    }
  }

  async function saveOrder(ids: string[] | null) {
    if (orderDisabled || reorderingRef.current || busyItemIdsRef.current.size > 0) return;
    if (!ids) return;
    reorderingRef.current = true;
    setReordering(true);
    setOrderError("");
    invalidatePendingLoads();
    const requestId = itemsRequestRef.current;
    try {
      const fresh = await permissionCatalogApi.reorderItems(ids);
      if (requestId !== itemsRequestRef.current) return;
      setItems(fresh);
      toast.success("显示顺序已保存");
    } catch (error) {
      if (requestId !== itemsRequestRef.current) return;
      const message = error instanceof Error ? error.message : "显示顺序保存失败，请重试";
      setOrderError(message);
      toast.error(message);
    } finally {
      reorderingRef.current = false;
      setReordering(false);
    }
  }

  function handleMove(branchKey: string, direction: -1 | 1, itemId?: string) {
    return saveOrder(moveRoutePages(items, branchKey, direction, itemId));
  }

  function clearDrag() {
    dragSourceRef.current = null;
    setDragSource(null);
    setDropTarget(null);
  }

  function startDrag(event: React.DragEvent<HTMLButtonElement>, source: DragSource) {
    if (orderDisabled || reorderingRef.current || busyItemIdsRef.current.size > 0) {
      event.preventDefault();
      return;
    }
    event.stopPropagation();
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", source.label);
    dragSourceRef.current = source;
    setDragSource(source);
    setDropTarget(null);
  }

  function canDrop(target: RouteOrderTarget) {
    const source = dragSourceRef.current;
    if (!source || orderDisabled || reorderingRef.current) return false;
    if (source.itemId) return source.branchKey === target.branchKey && source.itemId !== target.itemId && pageTree.some((root) => (
      root.branches.some((branch) => branch.key === target.branchKey && branch.items.some((item) => item.id === target.itemId))
    ));
    return !target.itemId && source.branchKey !== target.branchKey && pageTree.some((root) => (
      root.branches.some((branch) => branch.key === source.branchKey) && root.branches.some((branch) => branch.key === target.branchKey)
    ));
  }

  function dropPlacement(event: React.DragEvent<HTMLElement>): "before" | "after" {
    const bounds = event.currentTarget.getBoundingClientRect();
    return event.clientY < bounds.top + bounds.height / 2 ? "before" : "after";
  }

  function dragOver(event: React.DragEvent<HTMLElement>, target: RouteOrderTarget) {
    event.stopPropagation();
    if (!canDrop(target)) {
      setDropTarget(null);
      return;
    }
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    const placement = dropPlacement(event);
    setDropTarget((current) => current?.branchKey === target.branchKey && current.itemId === target.itemId && current.placement === placement
      ? current : { ...target, placement });
  }

  function drop(event: React.DragEvent<HTMLElement>, target: RouteOrderTarget) {
    event.stopPropagation();
    if (!canDrop(target)) { clearDrag(); return; }
    event.preventDefault();
    const ids = dropRoutePages(items, dragSourceRef.current!, target, dropPlacement(event));
    clearDrag();
    void saveOrder(ids);
  }

  function dragStyle(target: RouteOrderTarget): React.CSSProperties | undefined {
    if (dropTarget?.branchKey !== target.branchKey || dropTarget.itemId !== target.itemId) return undefined;
    return { boxShadow: `inset 0 ${dropTarget.placement === "before" ? "2px" : "-2px"} 0 var(--primary)` };
  }

  return (
    <div className="horizon-theme hz-page">
      <div className="hz-page-inner space-y-3">
        <HorizonPageHeader
          Icon={Layers3}
          eyebrow="SYSTEM GOVERNANCE · ROUTE CATALOG"
          title="页面路由管理"
          description="统一维护页面访问与按钮操作权限，控制角色授权目录、实际访问路径和侧边栏可见性。"
          meta={(
            <>
              <span>权限目录</span>
              <span aria-hidden="true">·</span>
              <span className="tabular-nums">{loading ? "正在同步" : `${items.length} 项配置`}</span>
            </>
          )}
          actions={(
            <>
              <Button type="button" variant="outline" onClick={() => void loadItems()} disabled={loading || saving || reordering || busyItemIds.size > 0}>
                <RefreshCw className="size-4" aria-hidden="true" />
                {loading ? "读取中…" : "刷新目录"}
              </Button>
              <Button type="button" className="hz-primary-action" disabled={reordering} onClick={(event) => openCreate(event.currentTarget)}>
                <Plus className="size-4" aria-hidden="true" />
                新增权限
              </Button>
            </>
          )}
        />

        <HorizonMetricGrid className="!grid-cols-2 xl:!grid-cols-4">
          <HorizonMetric Icon={ShieldCheck} label="权限总数" value={loading && items.length === 0 ? "—" : items.length} note={`${enabledCount} 项当前启用`} tone="brand" />
          <HorizonMetric Icon={FileText} label="页面权限" value={loading && items.length === 0 ? "—" : pageCount} note="控制页面访问路径" tone="brand" />
          <HorizonMetric Icon={MousePointerClick} label="按钮权限" value={loading && items.length === 0 ? "—" : actionCount} note="控制页面内操作" tone="neutral" />
          <HorizonMetric Icon={EyeOff} label="导航隐藏" value={loading && items.length === 0 ? "—" : hiddenCount} note={`${visibleCount} 个页面显示在导航`} tone={hiddenCount > 0 ? "warning" : "success"} />
        </HorizonMetricGrid>

        <section className="hz-surface min-w-0 overflow-hidden" aria-label="路由权限目录工作台">
          <HorizonSectionHeader
            Icon={FolderOpen}
            title="权限目录"
            description="按分组查看权限项，检索编码、名称、路径或说明，并维护路由与导航状态。"
            trailing={(
              <span className="text-xs text-slate-500">
                显示 <span className="tabular-nums font-semibold text-slate-700">{filteredItems.length}</span> / {items.length} 项
              </span>
            )}
          />

          <div className="grid gap-3 border-b border-slate-200 p-4 lg:grid-cols-[minmax(260px,1fr)_180px_200px_auto] lg:items-end">
            <div className="min-w-0">
              <Label htmlFor="route-catalog-search" className="mb-1.5 block text-xs font-semibold text-slate-700">搜索权限</Label>
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
                <Input
                  ref={searchInputRef}
                  id="route-catalog-search"
                  className="pl-9"
                  value={keyword}
                  onChange={(event) => setKeyword(event.target.value)}
                  placeholder="编码、名称、分组、路由或说明"
                />
              </div>
            </div>
            <div>
              <Label htmlFor="route-type-filter" className="mb-1.5 block text-xs font-semibold text-slate-700">权限类型</Label>
              <Select value={typeFilter} onValueChange={(value) => setTypeFilter(value as typeof typeFilter)}>
                <SelectTrigger id="route-type-filter" className="w-full" aria-label="筛选权限类型"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">全部类型</SelectItem>
                  <SelectItem value="page">页面权限</SelectItem>
                  <SelectItem value="action">按钮权限</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor="route-nav-filter" className="mb-1.5 block text-xs font-semibold text-slate-700">导航状态</Label>
              <Select value={navFilter} onValueChange={(value) => setNavFilter(value as typeof navFilter)}>
                <SelectTrigger id="route-nav-filter" className="w-full" aria-label="筛选导航状态"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">全部导航状态</SelectItem>
                  <SelectItem value="visible">导航显示</SelectItem>
                  <SelectItem value="hidden">导航隐藏</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <Button type="button" variant="outline" onClick={clearFilters} disabled={!isFiltering}>清除筛选</Button>
          </div>

          <div className="flex flex-col gap-2 border-b border-slate-200 bg-slate-50/70 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="space-y-1 text-xs text-pretty text-slate-600">
              <p id="route-order-help">拖动左侧手柄调整顺序：页面在组内移动，分组整体移动。松手后自动保存，也可用上下箭头微调。</p>
              <p className="text-slate-500">导航隐藏仅影响侧边栏展示，页面仍可通过链接访问，并继续出现在角色授权目录中。</p>
              <p role="status" aria-live="polite" className="min-h-4 font-medium text-primary">
                {reordering ? "正在保存显示顺序…" : partialPageFilter ? "清除搜索和导航状态筛选后，可调整完整页面顺序。" : dragSource
                  ? `正在移动${dragSource.label}，拖到目标位置松手；按 Esc 取消。` : ""}
              </p>
            </div>
            {routeTree.length > 0 ? (
              isFiltering ? (
                <span className="shrink-0 text-xs font-medium text-primary">筛选结果已展开</span>
              ) : (
                <Button type="button" variant="outline" size="sm" onClick={allExpanded ? collapseAll : expandAll}>
                  {allExpanded ? <Minus className="size-3.5" aria-hidden="true" /> : <Layers3 className="size-3.5" aria-hidden="true" />}
                  {allExpanded ? "折叠全部" : "展开全部"}
                </Button>
              )
            ) : null}
          </div>

          {orderError ? <p role="alert" className="border-b border-red-100 bg-red-50 px-4 py-3 text-xs text-red-700">{orderError}</p> : null}

          {loading && items.length === 0 ? (
            <LoadingTable />
          ) : routeTree.length === 0 ? (
            <HorizonEmptyState
              Icon={isFiltering ? Search : loadError ? RefreshCw : FolderOpen}
              title={isFiltering ? "没有匹配的权限项" : loadError ? "权限目录读取失败" : "尚未建立权限目录"}
              description={isFiltering ? "调整搜索词或筛选条件后重试。" : loadError || "新增首个权限项，建立统一的页面与操作授权目录。"}
              action={isFiltering ? (
                <Button type="button" variant="outline" onClick={clearFilters}>清除筛选</Button>
              ) : loadError ? (
                <Button type="button" variant="outline" onClick={() => void loadItems()}><RefreshCw className="size-4" aria-hidden="true" />重新读取</Button>
              ) : (
                <Button type="button" className="hz-primary-action" onClick={(event) => openCreate(event.currentTarget)}><Plus className="size-4" aria-hidden="true" />新增权限</Button>
              )}
            />
          ) : (
            <div className="divide-y divide-slate-200" onDragOver={() => setDropTarget(null)}
              onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDropTarget(null); }}>
              {routeTree.map((root, rootIndex) => {
                const rootExpanded = isFiltering || expandedRoots.has(root.label);
                const rootPanelId = `route-root-${rootIndex}`;
                const rootPageCount = root.items.filter((item) => item.type === "page").length;
                const rootHiddenCount = root.items.filter((item) => item.type === "page" && item.navHidden).length;

                return (
                  <article key={root.label}>
                    <h3>
                      <Button variant="unstyled"
                        type="button"
                        className="flex w-full cursor-pointer items-center gap-3 px-4 py-3.5 text-left hover:bg-accent/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary disabled:cursor-default disabled:hover:bg-transparent"
                        onClick={() => toggleRoot(root.label)}
                        disabled={isFiltering}
                        aria-expanded={rootExpanded}
                        aria-controls={rootPanelId}
                      >
                        <ChevronRight className={cn("size-4 shrink-0 text-muted-foreground", rootExpanded && "rotate-90 text-primary")} aria-hidden="true" />
                        <span className={cn("flex size-8 shrink-0 items-center justify-center rounded-xl", rootExpanded ? "bg-blue-100 text-primary" : "bg-slate-100 text-slate-600")} aria-hidden="true">
                          {rootExpanded ? <FolderOpen className="size-4" /> : <Folder className="size-4" />}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-semibold text-slate-900">{root.label}</span>
                          <span className="mt-0.5 block text-xs text-slate-500">
                            <span className="tabular-nums">{root.branches.length}</span> 个分组 · <span className="tabular-nums">{rootPageCount}</span> 个页面 · <span className="tabular-nums">{root.items.length - rootPageCount}</span> 个按钮
                          </span>
                        </span>
                        {rootHiddenCount > 0 ? <span className="shrink-0 rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-800 tabular-nums">{rootHiddenCount} 个导航隐藏</span> : null}
                      </Button>
                    </h3>

                    {rootExpanded ? (
                      <div id={rootPanelId} className="border-t border-slate-200 bg-slate-50/50">
                        {root.branches.map((branch, branchIndex) => {
                          const branchExpanded = (!dragSource || Boolean(dragSource.itemId)) && (isFiltering || expandedBranches.has(branch.key));
                          const branchPanelId = `route-branch-${rootIndex}-${branchIndex}`;
                          const branchPageCount = branch.items.filter((item) => item.type === "page").length;
                          const pageRoot = pageTree.find((candidate) => candidate.label === root.label);
                          const pageBranchIndex = pageRoot?.branches.findIndex((candidate) => candidate.key === branch.key) ?? -1;
                          const pageBranch = pageRoot?.branches[pageBranchIndex];

                          return (
                            <section key={branch.key} className="border-b border-slate-200 last:border-b-0" aria-labelledby={`${branchPanelId}-title`}>
                              <div className={cn("flex items-center px-4", dragSource?.branchKey === branch.key && !dragSource.itemId && "bg-primary/5")}
                                data-route-order-group={branch.key}
                                data-drop-placement={dropTarget?.branchKey === branch.key && !dropTarget.itemId ? dropTarget.placement : undefined}
                                style={dragStyle({ branchKey: branch.key })}
                                onDragOver={(event) => dragOver(event, { branchKey: branch.key })}
                                onDrop={(event) => drop(event, { branchKey: branch.key })}>
                                {pageBranch ? <DragHandle label={`分组“${branch.label}”`} disabled={orderDisabled || (pageRoot?.branches.length ?? 0) < 2}
                                  onStart={(event) => startDrag(event, { branchKey: branch.key, label: `分组“${branch.label}”` })} onEnd={clearDrag} /> : null}
                                <h4 id={`${branchPanelId}-title`} className="min-w-0 flex-1">
                                  <Button variant="unstyled"
                                    type="button"
                                    className="flex w-full cursor-pointer items-center gap-2 px-2 py-3 text-left hover:bg-accent/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary disabled:cursor-default disabled:hover:bg-transparent"
                                    onClick={() => toggleBranch(branch.key)}
                                    disabled={isFiltering}
                                    aria-expanded={branchExpanded}
                                    aria-controls={branchPanelId}
                                  >
                                    <ChevronRight className={cn("size-3.5 shrink-0 text-muted-foreground", branchExpanded && "rotate-90 text-primary")} aria-hidden="true" />
                                    <span className="min-w-0 flex-1 truncate text-xs font-semibold text-slate-700">{branch.label}</span>
                                    <span className="shrink-0 text-xs text-slate-500 tabular-nums">{branch.items.length} 项 · {branchPageCount} 页面 · {branch.items.length - branchPageCount} 按钮</span>
                                  </Button>
                                </h4>
                                {pageBranch ? <MoveButtons label={`分组“${branch.label}”`} index={pageBranchIndex} count={pageRoot?.branches.length ?? 0}
                                  disabled={orderDisabled} onMove={(direction) => void handleMove(branch.key, direction)} /> : null}
                              </div>

                              {branchExpanded ? (
                                <div id={branchPanelId} className="overflow-x-auto bg-white">
                                  <table className="w-full min-w-[1280px] table-fixed text-left">
                                    <caption className="sr-only">{root.label}中的{branch.label}权限项</caption>
                                    <colgroup>
                                      <col className="w-[320px]" />
                                      <col className="w-[100px]" />
                                      <col className="w-[250px]" />
                                      <col className="w-[100px]" />
                                      <col className="w-[170px]" />
                                      <col className="w-[120px]" />
                                      <col className="w-[150px]" />
                                      <col className="w-[90px]" />
                                    </colgroup>
                                    <thead className="bg-slate-50/90">
                                      <tr>
                                        {["权限项", "类型", "访问路径", "状态", "导航", "显示顺序", "更新时间", "操作"].map((column) => (
                                          <th key={column} scope="col" className={cn(TABLE_HEADER_CLASS, column === "操作" && "text-right")}>{column}</th>
                                        ))}
                                      </tr>
                                    </thead>
                                    <tbody className="divide-y divide-slate-100">
                                      {branch.items.map((item) => {
                                        const itemBusy = reordering || busyItemIds.has(item.id);
                                        const pageIndex = pageBranch?.items.findIndex((candidate) => candidate.id === item.id) ?? -1;
                                        return (
                                        <tr key={item.id} className={cn("hover:bg-accent/35", dragSource?.itemId === item.id && "bg-primary/5 opacity-50")}
                                          aria-busy={itemBusy} data-route-order-item={item.id}
                                          data-drop-placement={dropTarget?.itemId === item.id ? dropTarget.placement : undefined}
                                          style={dragStyle({ branchKey: branch.key, itemId: item.id })}
                                          onDragOver={(event) => dragOver(event, { branchKey: branch.key, itemId: item.id })}
                                          onDrop={(event) => drop(event, { branchKey: branch.key, itemId: item.id })}>
                                          <td className={TABLE_CELL_CLASS}>
                                            <div className="flex items-start gap-2">
                                              {item.type === "page" && pageBranch ? <DragHandle label={`页面“${item.label}”`} disabled={orderDisabled || pageBranch.items.length < 2}
                                                onStart={(event) => startDrag(event, { branchKey: branch.key, itemId: item.id, label: `页面“${item.label}”` })} onEnd={clearDrag} /> : null}
                                              <div className="min-w-0">
                                              <div className="font-semibold text-slate-900">{item.label}</div>
                                              <div className="mt-1 break-all font-mono text-xs text-slate-500">{item.code}</div>
                                              {item.description ? <p className="mt-1.5 line-clamp-2 text-pretty text-xs leading-5 text-slate-500">{item.description}</p> : null}
                                              </div>
                                            </div>
                                          </td>
                                          <td className={TABLE_CELL_CLASS}><TypeBadge type={item.type} /></td>
                                          <td className={TABLE_CELL_CLASS}>
                                            {item.routePath ? <code className="break-all rounded-md bg-slate-100 px-2 py-1 font-mono text-xs text-slate-700">{item.routePath}</code> : <span className="text-muted-foreground">不适用</span>}
                                          </td>
                                          <td className={TABLE_CELL_CLASS}>
                                            <span className={cn("inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold", item.enabled ? "border-green-200 bg-green-50 text-green-700" : "border-slate-200 bg-slate-100 text-slate-600")}>
                                              {item.enabled ? "启用" : "停用"}
                                            </span>
                                          </td>
                                          <td className={TABLE_CELL_CLASS}>
                                            {item.type === "page" ? (
                                              <div>
                                                <Button variant="unstyled"
                                                  type="button"
                                                  disabled={itemBusy}
                                                  onClick={() => void handleToggleNavHidden(item)}
                                                  className={cn(
                                                    "inline-flex cursor-pointer items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-not-allowed disabled:opacity-60",
                                                    item.navHidden ? "border-amber-200 bg-amber-50 text-amber-800 hover:bg-amber-100" : "border-green-200 bg-green-50 text-green-700 hover:bg-green-100",
                                                  )}
                                                  aria-label={`${item.navHidden ? "显示" : "隐藏"}“${item.label}”的侧边栏导航`}
                                                >
                                                  {item.navHidden ? <EyeOff className="size-3" aria-hidden="true" /> : <Eye className="size-3" aria-hidden="true" />}
                                                  {busyItemIds.has(item.id) ? "更新中…" : item.navHidden ? "导航隐藏" : "导航显示"}
                                                </Button>
                                                {actionError?.id === item.id ? <p role="alert" className="mt-1.5 text-pretty text-xs font-medium text-red-600">{actionError.message}</p> : null}
                                              </div>
                                            ) : <span className="text-muted-foreground">不适用</span>}
                                          </td>
                                          <td className={TABLE_CELL_CLASS}>
                                            {item.type === "page" && pageBranch ? (
                                              <div className="flex items-center gap-1">
                                                <span className="w-5 text-xs tabular-nums text-slate-500">{pageIndex + 1}</span>
                                                <MoveButtons label={`页面“${item.label}”`} index={pageIndex} count={pageBranch.items.length}
                                                  disabled={orderDisabled} onMove={(direction) => void handleMove(branch.key, direction, item.id)} />
                                              </div>
                                            ) : <span className="text-muted-foreground">—</span>}
                                          </td>
                                          <td className={cn(TABLE_CELL_CLASS, "text-xs text-slate-500 tabular-nums")}>{formatDate(item.updatedAt)}</td>
                                          <td className={cn(TABLE_CELL_CLASS, "text-right")}>
                                            <div className="flex justify-end gap-1">
                                              <Button type="button" variant="ghost" size="icon" disabled={itemBusy} onClick={(event) => openEdit(item, event.currentTarget)} aria-label={`编辑权限 ${item.label}`} title="编辑权限">
                                                <Edit3 className="size-4" aria-hidden="true" />
                                              </Button>
                                              <span title={item.builtIn ? "系统内置项不可删除，如需下线请改为停用" : "删除权限"}>
                                                <Button
                                                  type="button"
                                                  variant="ghost"
                                                  size="icon"
                                                  className="text-red-600 hover:bg-red-50 hover:text-red-700 disabled:cursor-not-allowed disabled:text-slate-400"
                                                  disabled={Boolean(item.builtIn) || itemBusy}
                                                  onClick={(event) => openDelete(item, event.currentTarget)}
                                                  aria-label={item.builtIn ? `${item.label}为系统内置项，不可删除` : `删除权限 ${item.label}`}
                                                >
                                                  <Trash2 className="size-4" aria-hidden="true" />
                                                </Button>
                                              </span>
                                            </div>
                                          </td>
                                        </tr>
                                        );
                                      })}
                                    </tbody>
                                  </table>
                                </div>
                              ) : null}
                            </section>
                          );
                        })}
                      </div>
                    ) : null}
                  </article>
                );
              })}
            </div>
          )}
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
          }}
        >
          <form onSubmit={(event) => { event.preventDefault(); void handleSave(); }} noValidate className="space-y-5">
            <DialogHeader>
              <DialogTitle className="text-balance text-slate-900">{dialogMode === "edit" ? "编辑权限目录" : "新增权限目录"}</DialogTitle>
              <DialogDescription className="text-pretty">维护权限编码、授权分组、页面路径与导航状态。页面路径变更会在刷新后全站生效。</DialogDescription>
            </DialogHeader>

            {dialogError ? <p role="alert" className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-pretty text-sm text-red-700">{dialogError}</p> : null}

            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <Label htmlFor="perm-code" className="mb-1.5 block text-sm font-semibold text-slate-700">权限编码 <span className="text-red-600">*</span></Label>
                <Input
                  ref={codeInputRef}
                  id="perm-code"
                  autoFocus
                  maxLength={120}
                  value={form.code}
                  onChange={(event) => { setForm((current) => ({ ...current, code: event.target.value })); clearFieldError("code"); }}
                  placeholder="如 page:route-management"
                  aria-invalid={Boolean(formErrors.code)}
                  aria-describedby={formErrors.code ? "perm-code-error" : "perm-code-help"}
                />
                {formErrors.code ? <p id="perm-code-error" role="alert" className="mt-1.5 text-xs font-medium text-red-600">{formErrors.code}</p> : <p id="perm-code-help" className="mt-1.5 text-xs text-slate-500">编码用于角色授权与接口校验，必须保持唯一。</p>}
              </div>
              <div>
                <Label htmlFor="perm-label" className="mb-1.5 block text-sm font-semibold text-slate-700">显示名称 <span className="text-red-600">*</span></Label>
                <Input
                  ref={labelInputRef}
                  id="perm-label"
                  maxLength={80}
                  value={form.label}
                  onChange={(event) => { setForm((current) => ({ ...current, label: event.target.value })); clearFieldError("label"); }}
                  placeholder="如 页面路由管理"
                  aria-invalid={Boolean(formErrors.label)}
                  aria-describedby={formErrors.label ? "perm-label-error" : undefined}
                />
                {formErrors.label ? <p id="perm-label-error" role="alert" className="mt-1.5 text-xs font-medium text-red-600">{formErrors.label}</p> : null}
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <Label htmlFor="perm-group" className="mb-1.5 block text-sm font-semibold text-slate-700">权限分组 <span className="text-red-600">*</span></Label>
                <Input
                  ref={groupInputRef}
                  id="perm-group"
                  list="permission-group-options"
                  maxLength={80}
                  value={form.groupLabel}
                  onChange={(event) => { setForm((current) => ({ ...current, groupLabel: event.target.value })); clearFieldError("groupLabel"); }}
                  placeholder="如 页面访问 · 系统管理"
                  aria-invalid={Boolean(formErrors.groupLabel)}
                  aria-describedby={formErrors.groupLabel ? "perm-group-error" : "perm-group-help"}
                />
                <datalist id="permission-group-options">{groupOptions.map((group) => <option key={group} value={group} />)}</datalist>
                {formErrors.groupLabel ? <p id="perm-group-error" role="alert" className="mt-1.5 text-xs font-medium text-red-600">{formErrors.groupLabel}</p> : <p id="perm-group-help" className="mt-1.5 text-xs text-slate-500">使用“一级分组 · 二级分组”形成目录层级。</p>}
              </div>
              <div>
                <Label htmlFor="perm-type" className="mb-1.5 block text-sm font-semibold text-slate-700">权限类型</Label>
                <Select value={form.type} onValueChange={(value) => { setForm((current) => ({ ...current, type: value as "page" | "action" })); clearFieldError("routePath"); }}>
                  <SelectTrigger id="perm-type" className="w-full" aria-label="选择权限类型"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="page">页面权限</SelectItem>
                    <SelectItem value="action">按钮权限</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_160px]">
              <div>
                <Label htmlFor="perm-path" className="mb-1.5 block text-sm font-semibold text-slate-700">访问路径 {form.type === "page" ? <span className="text-red-600">*</span> : null}</Label>
                <Input
                  ref={routePathInputRef}
                  id="perm-path"
                  maxLength={160}
                  value={form.routePath ?? ""}
                  onChange={(event) => { setForm((current) => ({ ...current, routePath: event.target.value })); clearFieldError("routePath"); }}
                  placeholder={form.type === "page" ? "如 /roles" : "按钮权限无需填写"}
                  aria-invalid={Boolean(formErrors.routePath)}
                  aria-describedby={formErrors.routePath ? "perm-path-error" : "perm-path-help"}
                />
                {formErrors.routePath ? <p id="perm-path-error" role="alert" className="mt-1.5 text-pretty text-xs font-medium text-red-600">{formErrors.routePath}</p> : (
                  <p id="perm-path-help" className="mt-1.5 text-pretty text-xs leading-5 text-slate-500">
                    {form.type === "page" ? "必须以 / 开头且不能与其他页面重复；可登记详情页参数路径，不支持空格、查询串、哈希或通配符。" : "按钮权限不参与前端路由，访问路径可留空。"}
                  </p>
                )}
              </div>
              <div>
                <Label htmlFor="perm-sort" className="mb-1.5 block text-sm font-semibold text-slate-700">排序</Label>
                <Input id="perm-sort" type="number" min={0} value={form.sortOrder} onChange={(event) => setForm((current) => ({ ...current, sortOrder: Number(event.target.value) || 0 }))} />
              </div>
            </div>

            {form.type === "page" && dialogMode === "create" ? (
              <p className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-pretty text-xs leading-5 text-amber-800">
                新增页面权限只会登记可授权页面；页面组件仍需在代码中绑定，未绑定的路径不会产生可访问页面。
              </p>
            ) : null}

            <div>
              <Label htmlFor="perm-desc" className="mb-1.5 block text-sm font-semibold text-slate-700">权限说明</Label>
              <Textarea id="perm-desc" maxLength={240} rows={3} value={form.description ?? ""} onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))} placeholder="说明该权限控制的页面或操作" />
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="flex items-start gap-3 rounded-xl border border-slate-200 bg-slate-50 p-3">
                <Checkbox id="perm-enabled" checked={form.enabled} onCheckedChange={(checked) => setForm((current) => ({ ...current, enabled: checked === true }))} />
                <div className="min-w-0">
                  <Label htmlFor="perm-enabled" className="cursor-pointer text-sm font-semibold text-slate-800">启用该权限</Label>
                  <p className="mt-1 text-pretty text-xs leading-5 text-slate-500">停用后该权限对所有普通账号失效，并从角色矩阵中移除。</p>
                </div>
              </div>
              {form.type === "page" ? (
                <div className="flex items-start gap-3 rounded-xl border border-slate-200 bg-slate-50 p-3">
                  <Checkbox id="perm-nav-visible" checked={!form.navHidden} onCheckedChange={(checked) => setForm((current) => ({ ...current, navHidden: checked !== true }))} />
                  <div className="min-w-0">
                    <Label htmlFor="perm-nav-visible" className="cursor-pointer text-sm font-semibold text-slate-800">显示在导航栏</Label>
                    <p className="mt-1 text-pretty text-xs leading-5 text-slate-500">取消后页面仍可访问，也仍可分配给角色。</p>
                  </div>
                </div>
              ) : null}
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={closeDialog} disabled={saving}>取消</Button>
              <Button type="submit" className="hz-primary-action" disabled={saving}>{saving ? "保存中…" : "保存权限"}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <AlertDialog open={dialogMode === "delete"} onOpenChange={(open) => { if (!open && !saving) closeDialog(); }}>
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
            <AlertDialogTitle className="text-balance text-slate-900">确认删除权限项？</AlertDialogTitle>
            <AlertDialogDescription className="text-pretty leading-6">
              即将删除“{selected?.label ?? "当前权限"}”。已分配给角色的权限编码不会自动清理，但后续权限矩阵将不再显示该项。此操作不可恢复。
            </AlertDialogDescription>
          </AlertDialogHeader>
          {dialogError ? <p role="alert" className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-pretty text-sm text-red-700">{dialogError}</p> : null}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={saving}>保留权限</AlertDialogCancel>
            <AlertDialogAction className="bg-red-600 text-white hover:bg-red-700 focus:ring-red-600" disabled={saving} onClick={(event) => { event.preventDefault(); void handleDelete(); }}>
              {saving ? "删除中…" : "确认删除"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
