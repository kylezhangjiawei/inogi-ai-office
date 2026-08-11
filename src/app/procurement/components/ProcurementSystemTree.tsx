import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
  FolderPlus,
  Layers3,
  LayoutDashboard,
  Loader2,
  LockKeyhole,
  Package,
  PackageSearch,
  Pencil,
  Plus,
  Search,
  Settings2,
  Trash2,
  X,
} from "lucide-react";
import { AnimatePresence, animate, motion, useReducedMotion } from "motion/react";
import { toast } from "sonner";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "../../components/ui/alert-dialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../../components/ui/dialog";
import { Input } from "../../components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../components/ui/select";
import { cn } from "../../components/ui/utils";
import { usePermission } from "../../hooks/usePermission";
import { useI18n } from "../../lib/i18n";
import { DEFAULT_PROCUREMENT_PRODUCT_ID, useProcurementProducts } from "../data";
import { ProcurementModuleDetail } from "./ProcurementModuleDetail";
import { CoreMaterialsPanorama } from "./CoreMaterialsPanorama";
import {
  createProcTaskTreeNode,
  deleteProcTaskTreeNode,
  listProcTaskTree,
  updateProcTaskTreeNode,
  type Material,
  type ProcurementTask,
  type ProcTaskTreeNode,
} from "../../lib/procurementApi";

type TreeEditor =
  | { mode: "add-root" }
  | { mode: "add-child"; parent: ProcTaskTreeNode }
  | { mode: "edit"; node: ProcTaskTreeNode }
  | { mode: "delete"; node: ProcTaskTreeNode };

const NO_MATERIAL_OPTION = "__no_material__";
const MATERIAL_SELECT_LIMIT = 200;

function findNode(nodes: ProcTaskTreeNode[], id: string): ProcTaskTreeNode | null {
  for (const node of nodes) {
    if (node.id === id) return node;
    const nested = findNode(node.children, id);
    if (nested) return nested;
  }
  return null;
}

function matchesNode(node: ProcTaskTreeNode, keyword: string) {
  const text = `${node.name} ${node.code ?? ""} ${node.spec ?? ""}`.toLowerCase();
  return text.includes(keyword);
}

type NodeHealth = "overdue" | "active" | "completed" | "closed" | "idle";

const NODE_HEALTH_STYLE: Record<NodeHealth, { label: string; dot: string; badge: string; border: string }> = {
  overdue: {
    label: "有逾期",
    dot: "bg-red-500",
    badge: "bg-red-50 text-red-700",
    border: "border-red-200",
  },
  active: {
    label: "进行中",
    dot: "bg-amber-500",
    badge: "bg-amber-50 text-amber-700",
    border: "border-amber-200",
  },
  completed: {
    label: "已完成",
    dot: "bg-emerald-500",
    badge: "bg-emerald-50 text-emerald-700",
    border: "border-emerald-200",
  },
  closed: {
    label: "已关闭",
    dot: "bg-slate-400",
    badge: "bg-slate-100 text-slate-600",
    border: "border-slate-200",
  },
  idle: {
    label: "无任务",
    dot: "bg-slate-300",
    badge: "bg-slate-100 text-slate-500",
    border: "border-slate-200",
  },
};

const STOCK_QUANTITY_FORMATTER = new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 3 });

function getNodeMetrics(node: ProcTaskTreeNode, tasksById: Map<string, ProcurementTask>) {
  const nodeTasks = node.taskIds.flatMap((id) => {
    const task = tasksById.get(id);
    return task ? [task] : [];
  });
  const latestTasks = [...nodeTasks]
    .sort((left, right) => {
      const createdAtDifference = Date.parse(right.createdAt) - Date.parse(left.createdAt);
      return createdAtDifference || right.id.localeCompare(left.id);
    })
    .slice(0, 3);
  const completed = nodeTasks.filter((task) => task.status === "completed").length;
  const cancelled = nodeTasks.filter((task) => task.status === "cancelled").length;
  const terminal = completed + cancelled;
  const active = Math.max(0, nodeTasks.length - terminal);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const overdue = nodeTasks.filter((task) => {
    if (!task.deadline || task.status === "completed" || task.status === "cancelled") return false;
    const deadline = new Date(task.deadline);
    deadline.setHours(0, 0, 0, 0);
    return Number.isFinite(deadline.getTime()) && deadline < today;
  }).length;
  const total = node.taskCount;
  const progressTotal = Math.max(0, total - cancelled);
  const progress = progressTotal > 0 ? Math.round((completed / progressTotal) * 100) : 0;
  const health: NodeHealth = overdue > 0
    ? "overdue"
    : active > 0
      ? "active"
      : completed > 0
        ? "completed"
        : cancelled > 0
          ? "closed"
          : "idle";

  return { active, completed, health, latestTasks, overdue, progress, total };
}

function getTaskDescription(task: ProcurementTask) {
  const detail = task.consumableNote?.trim() || task.rdTaskTitle?.trim() || task.spec.trim();
  return [task.materialName, detail].filter(Boolean).join(" · ");
}

function getNodeInventory(node: ProcTaskTreeNode, materialsById: Map<string, Material>) {
  const materialIds = new Set<string>();
  const collectMaterialIds = (current: ProcTaskTreeNode) => {
    if (current.materialId) materialIds.add(current.materialId);
    current.children.forEach(collectMaterialIds);
  };
  collectMaterialIds(node);

  let stockQty = 0;
  materialIds.forEach((materialId) => {
    stockQty += materialsById.get(materialId)?.stockQty ?? 0;
  });
  return stockQty;
}

function formatStockQuantity(value: number) {
  return STOCK_QUANTITY_FORMATTER.format(value);
}

function PanoramaNodeCard({
  isRoot,
  isSelected,
  manageMode,
  node,
  onAddChild,
  onDelete,
  onEdit,
  onSelect,
  materialsById,
  tasksById,
}: {
  isRoot: boolean;
  isSelected: boolean;
  manageMode: boolean;
  node: ProcTaskTreeNode;
  onAddChild?: () => void;
  onDelete?: () => void;
  onEdit?: () => void;
  onSelect: () => void;
  materialsById: Map<string, Material>;
  tasksById: Map<string, ProcurementTask>;
}) {
  const { t } = useI18n();
  const metrics = getNodeMetrics(node, tasksById);
  const health = NODE_HEALTH_STYLE[metrics.health];
  const locked = node.taskCount > 0;
  const stockQty = getNodeInventory(node, materialsById);
  const isIdle = metrics.total === 0;

  return (
    <div
      className={cn(
        "group relative h-full overflow-hidden rounded-xl border bg-white shadow-sm transition-colors",
        isSelected ? "border-indigo-300 ring-2 ring-indigo-100" : health.border,
        metrics.health === "idle" && "bg-slate-50/30",
      )}
    >
      <button
        type="button"
        onClick={onSelect}
        className={cn(
          "flex h-full min-h-44 w-full flex-col p-4 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-400",
          manageMode && "pb-14",
        )}
      >
        <span className={cn("absolute inset-x-0 top-0 h-0.5", health.dot)} />
        <span className="flex w-full items-start gap-2">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-600">
            <Layers3 className="size-4" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-semibold text-slate-900">{node.name}</span>
            <span className="mt-0.5 block truncate text-xs text-slate-500">
              {isRoot
                ? t("{count} 个名称节点", { count: node.children.length })
                : [node.code, node.spec].filter(Boolean).join(" · ") || t("未设置编码与规格")}
            </span>
          </span>
          <span className={cn("inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold", health.badge)}>
            <span className={cn("size-1 rounded-full", health.dot)} />
            {t(health.label)}
          </span>
        </span>

        {isIdle ? (
          <span className="mt-auto flex w-full items-center justify-between rounded-lg border border-slate-100 bg-white px-3 py-3">
            <span className="flex items-center gap-2 text-xs text-slate-500">
              <Package className="size-3.5 text-slate-400" />
              {t("库存")}
              <strong className="font-semibold tabular-nums text-slate-800">{formatStockQuantity(stockQty)}</strong>
            </span>
            <span className="text-xs text-slate-500">{t("暂无采购任务")}</span>
          </span>
        ) : (
          <>
            <span className="mt-4 flex w-full items-center justify-between gap-2">
              <span className="text-3xl font-semibold tabular-nums text-slate-900">
                {metrics.progress}<span className="text-base text-slate-400">%</span>
              </span>
              <span className="flex items-center gap-1.5">
                {metrics.overdue > 0 && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-red-50 px-2 py-0.5 text-xs font-semibold tabular-nums text-red-600">
                    <AlertTriangle className="size-3" />
                    {metrics.overdue}
                  </span>
                )}
                <span className="inline-flex items-center gap-1 rounded-lg border border-slate-100 bg-slate-50 px-2 py-1 text-[11px] text-slate-500">
                  <Package className="size-3 text-slate-400" />
                  <span>{t("库存")}</span>
                  <strong className="font-semibold tabular-nums text-slate-700">{formatStockQuantity(stockQty)}</strong>
                </span>
              </span>
            </span>

            <span className="mt-2 h-1 w-full overflow-hidden rounded-full bg-slate-100">
              <span className={cn("block h-full rounded-full", health.dot)} style={{ width: `${metrics.progress}%` }} />
            </span>

            {metrics.latestTasks.length > 0 && (
              <span className="mt-3 block w-full rounded-lg bg-slate-50 px-2.5 py-2">
                <span className="mb-1 block text-[11px] font-medium text-slate-500">{t("最新任务")}</span>
                {metrics.latestTasks.map((task) => {
                  const description = getTaskDescription(task);
                  return (
                    <span key={task.id} className="flex min-w-0 items-center gap-1.5 py-0.5 text-xs text-slate-600">
                      <span className="size-1 shrink-0 rounded-full bg-indigo-400" />
                      <span className="min-w-0 flex-1 truncate" title={description}>{description}</span>
                    </span>
                  );
                })}
              </span>
            )}

            <span className="mt-auto flex w-full items-center justify-between pt-3 text-xs text-slate-500">
              <span><strong className="font-semibold tabular-nums text-slate-800">{metrics.total}</strong> {t("任务")}</span>
              <span><strong className="font-semibold tabular-nums text-indigo-600">{metrics.active}</strong> {t("进行中")}</span>
              <span><strong className="font-semibold tabular-nums text-emerald-600">{metrics.completed}</strong> {t("完成")}</span>
            </span>
          </>
        )}
      </button>

      {manageMode && (
        <div className="absolute bottom-3 right-3 flex items-center gap-1 rounded-lg border border-slate-200 bg-white p-1 shadow-sm">
          {isRoot && onAddChild && (
            <button type="button" onClick={onAddChild} aria-label={t("新增名称节点")} title={t("新增名称节点")} className="rounded-md p-1.5 text-indigo-600 hover:bg-indigo-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400">
              <FolderPlus className="size-3.5" />
            </button>
          )}
          {onEdit && (
            <button
              type="button"
              disabled={locked}
              onClick={onEdit}
              aria-label={locked ? t("节点已有任务，不能修改") : t("修改节点")}
              title={locked ? t("节点已有任务，不能修改") : t("修改节点")}
              className={cn("rounded-md p-1.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400", locked ? "cursor-not-allowed text-slate-300" : "text-slate-500 hover:bg-slate-100 hover:text-slate-800")}
            >
              {locked ? <LockKeyhole className="size-3.5" /> : <Pencil className="size-3.5" />}
            </button>
          )}
          {onDelete && (
            <button
              type="button"
              disabled={locked}
              onClick={onDelete}
              aria-label={locked ? t("节点已有任务，不能删除") : t("删除节点")}
              title={locked ? t("节点已有任务，不能删除") : t("删除节点")}
              className={cn("rounded-md p-1.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400", locked ? "cursor-not-allowed text-slate-300" : "text-slate-500 hover:bg-red-50 hover:text-red-600")}
            >
              <Trash2 className="size-3.5" />
            </button>
          )}
        </div>
      )}
    </div>
  );
}

export function ProcurementSystemTree({
  tasks,
  materials,
  selected,
  onSelect,
  onShowTasks,
  detailNodeId,
  requestedProductId,
  onCloseModule,
  onOpenModule,
  onProductChange,
  coreMode,
  coreMaterialsByProduct,
  coreMaterialLimit,
  coreConfigLoading,
  coreConfigError,
  onRetryCoreConfig,
  onCoreModeChange,
  onSaveCoreMaterials,
}: {
  tasks: ProcurementTask[];
  materials: Material[];
  selected: ProcTaskTreeNode | null;
  onSelect: (node: ProcTaskTreeNode | null) => void;
  onShowTasks?: (productId: string) => void;
  detailNodeId?: string | null;
  requestedProductId?: string | null;
  onCloseModule?: () => void;
  onOpenModule?: (node: ProcTaskTreeNode, productId: string) => void;
  onProductChange?: (productId: string) => void;
  coreMode: boolean;
  coreMaterialsByProduct: Record<string, string[]>;
  coreMaterialLimit: number;
  coreConfigLoading: boolean;
  coreConfigError: string | null;
  onRetryCoreConfig: () => void;
  onCoreModeChange: (active: boolean) => void;
  onSaveCoreMaterials: (productId: string, materialIds: string[]) => Promise<void>;
}) {
  const { t } = useI18n();
  const shouldReduceMotion = useReducedMotion();
  const products = useProcurementProducts();
  const canEdit = usePermission("proc-task:create");
  const canDelete = usePermission("proc-task:delete");
  const canManage = canEdit || canDelete;
  const [roots, setRoots] = useState<ProcTaskTreeNode[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [keyword, setKeyword] = useState("");
  const [activeProductId, setActiveProductId] = useState(requestedProductId || DEFAULT_PROCUREMENT_PRODUCT_ID);
  const [activeRootId, setActiveRootId] = useState<string | null>(null);
  const [manageMode, setManageMode] = useState(false);
  const [editor, setEditor] = useState<TreeEditor | null>(null);
  const categoryNavRef = useRef<HTMLElement | null>(null);
  const categoryScrollAnimationRef = useRef<{ stop: () => void } | null>(null);
  const treeRequestRef = useRef(0);
  const [categoryNavEdges, setCategoryNavEdges] = useState({ left: false, right: false });
  const categoryTransition = shouldReduceMotion
    ? { duration: 0 }
    : { duration: 0.18, ease: "easeOut" as const };

  const taskFingerprint = useMemo(
    () => tasks
      .filter((task) => task.productId === activeProductId)
      .map((task) => `${task.id}:${task.materialId ?? ""}:${task.updatedAt}`)
      .join("|"),
    [activeProductId, tasks],
  );

  const loadTree = useCallback(async () => {
    const requestId = ++treeRequestRef.current;
    setLoading(true);
    setError(null);
    try {
      const data = await listProcTaskTree(activeProductId);
      if (requestId !== treeRequestRef.current) return;
      setRoots(data.roots);
      setActiveRootId((current) => current && data.roots.some((root) => root.id === current) ? current : null);
    } catch (cause) {
      if (requestId !== treeRequestRef.current) return;
      setError(cause instanceof Error ? cause.message : t("系统树加载失败"));
    } finally {
      if (requestId === treeRequestRef.current) setLoading(false);
    }
  }, [activeProductId, t]);

  useEffect(() => {
    if (products.length === 0 || products.some((product) => product.id === activeProductId)) return;
    setActiveProductId(products[0].id);
  }, [activeProductId, products]);

  useEffect(() => {
    if (!requestedProductId || requestedProductId === activeProductId) return;
    setActiveProductId(requestedProductId);
    setRoots([]);
    setActiveRootId(null);
    setEditor(null);
    onSelect(null);
  }, [activeProductId, onSelect, requestedProductId]);

  useEffect(() => {
    void loadTree();
  }, [loadTree, taskFingerprint]);

  useEffect(() => {
    if (!selected) return;
    const refreshed = findNode(roots, selected.id);
    if (!refreshed) onSelect(null);
    else if (refreshed !== selected) onSelect(refreshed);
  }, [roots, selected, onSelect]);

  const normalizedKeyword = keyword.trim().toLowerCase();
  const tasksById = useMemo(
    () => new Map(tasks.filter((task) => task.productId === activeProductId).map((task) => [task.id, task])),
    [activeProductId, tasks],
  );
  const materialsById = useMemo(
    () => new Map(materials.map((material) => [material.id, material])),
    [materials],
  );
  const visibleRoots = useMemo(() => {
    if (!normalizedKeyword) return roots;
    return roots
      .map((root) => {
        if (matchesNode(root, normalizedKeyword)) return root;
        const children = root.children.filter((child) => matchesNode(child, normalizedKeyword));
        return children.length > 0 ? { ...root, children } : null;
      })
      .filter((root): root is ProcTaskTreeNode => root !== null);
  }, [normalizedKeyword, roots]);

  const activeRoot = useMemo(
    () => visibleRoots.find((root) => root.id === activeRootId) ?? null,
    [activeRootId, visibleRoots],
  );
  const visibleNodes = activeRoot ? activeRoot.children : visibleRoots;
  const legend = useMemo(
    () => (Object.keys(NODE_HEALTH_STYLE) as NodeHealth[]).map((health) => ({
      count: visibleNodes.filter((node) => getNodeMetrics(node, tasksById).health === health).length,
      health,
    })),
    [tasksById, visibleNodes],
  );

  const updateCategoryNavEdges = useCallback(() => {
    const nav = categoryNavRef.current;
    if (!nav) return;
    const maxScrollLeft = Math.max(0, nav.scrollWidth - nav.clientWidth);
    setCategoryNavEdges({
      left: nav.scrollLeft > 1,
      right: nav.scrollLeft < maxScrollLeft - 1,
    });
  }, []);

  useEffect(() => {
    const nav = categoryNavRef.current;
    if (!nav) return;
    updateCategoryNavEdges();
    const observer = new ResizeObserver(updateCategoryNavEdges);
    observer.observe(nav);
    return () => observer.disconnect();
  }, [updateCategoryNavEdges, visibleRoots.length]);

  useEffect(() => () => categoryScrollAnimationRef.current?.stop(), []);

  const scrollCategoryNav = (direction: -1 | 1) => {
    const nav = categoryNavRef.current;
    if (!nav) return;
    const maxScrollLeft = Math.max(0, nav.scrollWidth - nav.clientWidth);
    const distance = Math.max(240, Math.round(nav.clientWidth * 0.6));
    const target = Math.min(maxScrollLeft, Math.max(0, nav.scrollLeft + direction * distance));
    categoryScrollAnimationRef.current?.stop();
    if (shouldReduceMotion) {
      nav.scrollLeft = target;
      return;
    }
    categoryScrollAnimationRef.current = animate(nav.scrollLeft, target, {
      duration: 0.2,
      ease: "easeOut",
      onUpdate: (value) => {
        nav.scrollLeft = value;
      },
    });
  };

  const selectNode = (node: ProcTaskTreeNode | null) => {
    if (node?.parentId && node.children.length === 0 && onOpenModule) {
      onSelect(node);
      setActiveRootId(node.parentId);
      onOpenModule(node, activeProductId);
      return;
    }
    onSelect(selected?.id === node?.id ? null : node);
    if (!node) setActiveRootId(null);
    else setActiveRootId(node.parentId ?? node.id);
  };

  const activeProduct = products.find((product) => product.id === activeProductId) ?? products[0];

  const selectProduct = (productId: string) => {
    if (productId === activeProductId) return;
    setActiveProductId(productId);
    setRoots([]);
    setActiveRootId(null);
    setEditor(null);
    onSelect(null);
    onProductChange?.(productId);
  };

  const detailNode = detailNodeId ? findNode(roots, detailNodeId) : null;
  const detailParent = detailNode?.parentId ? findNode(roots, detailNode.parentId) : null;

  if (detailNodeId) {
    if (detailNode) {
      return (
        <ProcurementModuleDetail
          materials={materials}
          node={detailNode}
          parentName={detailParent?.name}
          productName={activeProduct?.name ?? activeProductId}
          tasks={tasks}
          onBack={() => onCloseModule?.()}
        />
      );
    }
    return (
      <section className="material-card flex min-h-0 flex-1 items-center justify-center border-slate-200 bg-white shadow-sm">
        {loading ? (
          <div className="flex items-center gap-2 text-sm text-slate-400"><Loader2 className="size-4 animate-spin motion-reduce:animate-none" />{t("加载模块详情…")}</div>
        ) : (
          <div className="text-center">
            <p className="text-sm font-medium text-slate-500">{error || t("模块不存在或已被删除")}</p>
            <button type="button" onClick={() => onCloseModule?.()} className="mt-3 text-xs font-semibold text-indigo-600 hover:text-indigo-700">{t("返回子系统全景")}</button>
          </div>
        )}
      </section>
    );
  }

  return (
    <section className="material-card flex min-h-0 flex-1 flex-col overflow-hidden border-slate-200 bg-white shadow-sm">
      <header className="flex flex-wrap items-start justify-between gap-4 px-5 pb-4 pt-5">
        <div className="flex min-w-0 flex-wrap items-center gap-3">
          {onShowTasks && (
            <button
              type="button"
              onClick={() => onShowTasks(activeProductId)}
              className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-indigo-200 bg-indigo-50 px-3 text-xs font-semibold text-indigo-700 hover:bg-indigo-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
            >
              <LayoutDashboard className="size-3.5" />
              {t("返回任务驾驶舱")}
            </button>
          )}
          <div className="inline-flex items-center gap-1 rounded-lg bg-slate-100 p-1" role="tablist" aria-label={t("子系统全景视图")}>
            <button
              type="button"
              role="tab"
              aria-selected={!coreMode}
              onClick={() => onCoreModeChange(false)}
              className={cn("inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold", !coreMode ? "bg-white text-indigo-700 shadow-sm" : "text-slate-500 hover:text-slate-800")}
            >
              <Layers3 className="size-3.5" />
              {t("分类全景")}
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={coreMode}
              onClick={() => onCoreModeChange(true)}
              className={cn("inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold", coreMode ? "bg-white text-indigo-700 shadow-sm" : "text-slate-500 hover:text-slate-800")}
            >
              <PackageSearch className="size-3.5" />
              {t("核心配件")}
            </button>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-end gap-2">
          {!coreMode && !loading && !error && visibleNodes.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5">
              {legend.map(({ count, health }) => {
                const style = NODE_HEALTH_STYLE[health];
                return (
                  <span key={health} className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-slate-50 px-2 py-1 text-[11px] text-slate-500">
                    <span className={cn("size-1.5 rounded-full", style.dot)} />
                    {t(style.label)}
                    <strong className="font-semibold tabular-nums text-slate-700">{count}</strong>
                  </span>
                );
              })}
            </div>
          )}
          {!coreMode && <div className="flex h-8 items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50/80 px-2.5 focus-within:border-indigo-300 focus-within:bg-white focus-within:ring-2 focus-within:ring-indigo-100">
            <Search className="size-3.5 text-slate-400" />
            <Input
              value={keyword}
              onChange={(event) => setKeyword(event.target.value)}
              placeholder={t("搜索分类 / 名称 / 编码")}
              className="h-7 w-32 border-0 bg-transparent p-0 text-xs shadow-none outline-none focus-visible:ring-0 xl:w-36"
            />
            {keyword && (
              <button type="button" onClick={() => setKeyword("")} aria-label={t("清空搜索")} className="rounded text-slate-400 hover:text-slate-700">
                <X className="size-3" />
              </button>
            )}
          </div>}
          {!coreMode && canManage && (
            <>
              {manageMode && canEdit && (
                <button type="button" onClick={() => setEditor({ mode: "add-root" })} className="inline-flex items-center gap-1.5 rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-1.5 text-xs font-semibold text-indigo-700 hover:bg-indigo-100">
                  <Plus className="size-3.5" />
                  {t("新增分类")}
                </button>
              )}
              <button
                type="button"
                onClick={() => setManageMode((current) => !current)}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-semibold",
                  manageMode ? "border-indigo-200 bg-indigo-50 text-indigo-700" : "border-slate-200 bg-slate-50 text-slate-600 hover:border-indigo-200 hover:text-indigo-700",
                )}
              >
                <Settings2 className="size-3.5" />
                {manageMode ? t("完成管理") : t("管理分类")}
              </button>
            </>
          )}
        </div>
      </header>

      <div className="border-y border-slate-100 bg-white px-5" role="tablist" aria-label={t("采购产品系统")}>
        <div className="flex min-w-0 gap-1 overflow-x-auto [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {products.map((product) => {
            const isActive = product.id === activeProductId;
            const dot = product.status === "active"
              ? "bg-emerald-500"
              : product.status === "paused"
                ? "bg-amber-500"
                : product.status === "archived"
                  ? "bg-slate-400"
                  : "bg-indigo-500";
            return (
              <button
                key={product.id}
                type="button"
                role="tab"
                aria-selected={isActive}
                onClick={() => selectProduct(product.id)}
                className={cn(
                  "relative flex h-12 shrink-0 items-center gap-2 px-4 text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-400",
                  isActive ? "text-indigo-700" : "text-slate-500 hover:bg-slate-50 hover:text-slate-800",
                )}
              >
                <span className={cn("size-2 rounded-full", dot)} />
                <span className="max-w-56 truncate">{t(product.name)}</span>
                {isActive && (
                  <motion.span
                    layoutId="procurement-product-active"
                    aria-hidden="true"
                    className="absolute inset-x-3 bottom-0 h-0.5 rounded-full bg-indigo-500"
                    transition={categoryTransition}
                  />
                )}
              </button>
            );
          })}
        </div>
      </div>

      {!coreMode && <div className="relative border-b border-slate-100 bg-slate-50/80 px-11 py-2">
        <button
          type="button"
          onClick={() => scrollCategoryNav(-1)}
          disabled={!categoryNavEdges.left}
          aria-label={t("向左浏览采购分类")}
          className="absolute left-2 top-1/2 z-10 flex size-7 -translate-y-1/2 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-500 shadow-sm transition-opacity duration-150 hover:border-indigo-200 hover:text-indigo-700 disabled:pointer-events-none disabled:opacity-30"
        >
          <ChevronLeft className="size-4" />
        </button>

        <nav
          ref={categoryNavRef}
          onScroll={updateCategoryNavEdges}
          onPointerDown={() => categoryScrollAnimationRef.current?.stop()}
          onWheel={() => categoryScrollAnimationRef.current?.stop()}
          className="flex gap-1.5 overflow-x-auto [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          aria-label={t("采购分类")}
        >
          <button
            type="button"
            onClick={() => selectNode(null)}
            className={cn(
              "relative isolate flex shrink-0 items-center rounded-lg border border-transparent px-3 py-1.5 text-xs font-semibold",
              !activeRoot
                ? "text-indigo-700"
                : "text-slate-600 hover:border-slate-200 hover:bg-white hover:text-slate-900",
            )}
          >
            {!activeRoot && (
              <motion.span
                layoutId="procurement-category-active"
                aria-hidden="true"
                className="absolute inset-0 z-0 rounded-lg border border-indigo-200 bg-white shadow-sm"
                transition={categoryTransition}
              />
            )}
            <span className="relative z-10 flex items-center gap-2">
              {t("全部分类")}
              <span className={cn(
                "rounded-full px-1.5 text-[11px] tabular-nums",
                !activeRoot ? "bg-indigo-50 text-indigo-600" : "bg-slate-200/70 text-slate-500",
              )}>
                {visibleRoots.length}
              </span>
            </span>
          </button>
          {visibleRoots.map((root) => {
            const isActive = activeRoot?.id === root.id;
            return (
              <button
                key={root.id}
                type="button"
                onClick={() => selectNode(root)}
                className={cn(
                  "relative isolate flex shrink-0 items-center rounded-lg border border-transparent px-3 py-1.5 text-xs font-semibold",
                  isActive
                    ? "text-indigo-700"
                    : "text-slate-600 hover:border-slate-200 hover:bg-white hover:text-slate-900",
                )}
              >
                {isActive && (
                  <motion.span
                    layoutId="procurement-category-active"
                    aria-hidden="true"
                    className="absolute inset-0 z-0 rounded-lg border border-indigo-200 bg-white shadow-sm"
                    transition={categoryTransition}
                  />
                )}
                <span className="relative z-10 flex items-center gap-2">
                  <span className={cn("size-1.5 rounded-full", root.taskCount > 0 ? "bg-indigo-500" : "bg-slate-300")} />
                  <span className="max-w-40 truncate">{root.name}</span>
                  <span className={cn(
                    "rounded-full px-1.5 text-[11px] tabular-nums",
                    isActive ? "bg-indigo-50 text-indigo-600" : "bg-slate-200/70 text-slate-500",
                  )}>
                    {root.taskCount}
                  </span>
                </span>
              </button>
            );
          })}
        </nav>

        <button
          type="button"
          onClick={() => scrollCategoryNav(1)}
          disabled={!categoryNavEdges.right}
          aria-label={t("向右浏览采购分类")}
          className="absolute right-2 top-1/2 z-10 flex size-7 -translate-y-1/2 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-500 shadow-sm transition-opacity duration-150 hover:border-indigo-200 hover:text-indigo-700 disabled:pointer-events-none disabled:opacity-30"
        >
          <ChevronRight className="size-4" />
        </button>
      </div>}

      <div className={cn("min-h-0 flex-1", coreMode ? "flex" : "overflow-y-auto p-5")}>
        {coreMode ? (
          <CoreMaterialsPanorama
            productId={activeProductId}
            productName={activeProduct?.name ?? activeProductId}
            roots={roots}
            materials={materials}
            configuredIds={coreMaterialsByProduct[activeProductId] ?? []}
            maxItems={coreMaterialLimit}
            configLoading={coreConfigLoading}
            configError={coreConfigError}
            canManage={canEdit}
            onRetryConfig={onRetryCoreConfig}
            onSave={onSaveCoreMaterials}
          />
        ) : <>
        {activeRoot && canManage && manageMode && (
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-indigo-100 bg-indigo-50 px-3 py-2">
            <div className="min-w-0">
              <p className="truncate text-xs font-semibold text-indigo-900">{activeRoot.name}</p>
              <p className="text-[11px] text-indigo-600">{t("当前分类 · {count} 个名称节点", { count: activeRoot.children.length })}</p>
            </div>
            <div className="flex items-center gap-1">
              {canEdit && (
                <>
                  <button type="button" onClick={() => setEditor({ mode: "add-child", parent: activeRoot })} className="inline-flex items-center gap-1 rounded-md bg-white px-2 py-1.5 text-[11px] font-semibold text-indigo-700 shadow-sm hover:bg-indigo-50">
                    <FolderPlus className="size-3.5" />
                    {t("新增名称")}
                  </button>
                  <button
                    type="button"
                    disabled={activeRoot.taskCount > 0}
                    onClick={() => activeRoot.taskCount === 0 && setEditor({ mode: "edit", node: activeRoot })}
                    aria-label={activeRoot.taskCount > 0 ? t("节点已有任务，不能修改") : t("修改分类")}
                    title={activeRoot.taskCount > 0 ? t("节点已有任务，不能修改") : t("修改分类")}
                    className={cn("rounded-md bg-white p-1.5 shadow-sm", activeRoot.taskCount > 0 ? "cursor-not-allowed text-slate-300" : "text-slate-500 hover:text-slate-800")}
                  >
                    {activeRoot.taskCount > 0 ? <LockKeyhole className="size-3.5" /> : <Pencil className="size-3.5" />}
                  </button>
                </>
              )}
              {canDelete && (
                <button
                  type="button"
                  disabled={activeRoot.taskCount > 0}
                  onClick={() => activeRoot.taskCount === 0 && setEditor({ mode: "delete", node: activeRoot })}
                  aria-label={activeRoot.taskCount > 0 ? t("节点已有任务，不能删除") : t("删除分类")}
                  title={activeRoot.taskCount > 0 ? t("节点已有任务，不能删除") : t("删除分类")}
                  className={cn("rounded-md bg-white p-1.5 shadow-sm", activeRoot.taskCount > 0 ? "cursor-not-allowed text-slate-300" : "text-slate-500 hover:text-red-600")}
                >
                  <Trash2 className="size-3.5" />
                </button>
              )}
            </div>
          </div>
        )}
        {loading && roots.length === 0 ? (
          <div className="flex items-center justify-center gap-2 py-12 text-xs text-slate-400"><Loader2 className="size-4 animate-spin motion-reduce:animate-none" />{t("加载系统全景…")}</div>
        ) : error ? (
          <button type="button" onClick={() => void loadTree()} className="w-full rounded-lg border border-dashed border-red-200 bg-red-50 px-3 py-8 text-xs text-red-600">{error}<span className="mt-1 block font-semibold">{t("点击重试")}</span></button>
        ) : visibleNodes.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-slate-200 bg-slate-50 px-4 py-10 text-center">
            <Layers3 className="mb-2 size-7 text-slate-300" />
            <p className="text-sm font-medium text-slate-500">{normalizedKeyword ? t("没有匹配的节点") : activeRoot ? t("该分类暂无名称节点") : t("暂无采购分类")}</p>
            {canEdit && !normalizedKeyword && (
              <button type="button" onClick={() => setEditor(activeRoot ? { mode: "add-child", parent: activeRoot } : { mode: "add-root" })} className="mt-3 inline-flex items-center gap-1.5 rounded-lg border border-indigo-200 bg-white px-3 py-1.5 text-xs font-semibold text-indigo-700 hover:bg-indigo-50">
                <Plus className="size-3.5" />
                {activeRoot ? t("新增名称节点") : t("新增分类")}
              </button>
            )}
          </div>
        ) : (
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={activeRoot?.id ?? "all-categories"}
              initial={shouldReduceMotion ? false : { opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={shouldReduceMotion ? undefined : { opacity: 0, y: -4 }}
              transition={categoryTransition}
              className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5"
            >
              {visibleNodes.map((node) => (
                <PanoramaNodeCard
                  key={node.id}
                  node={node}
                  isRoot={!activeRoot}
                  isSelected={selected?.id === node.id}
                  manageMode={canManage && manageMode}
                  materialsById={materialsById}
                  tasksById={tasksById}
                  onSelect={() => selectNode(node)}
                  onAddChild={canEdit && !activeRoot ? () => setEditor({ mode: "add-child", parent: node }) : undefined}
                  onEdit={canEdit ? () => node.taskCount === 0 && setEditor({ mode: "edit", node }) : undefined}
                  onDelete={canDelete ? () => node.taskCount === 0 && setEditor({ mode: "delete", node }) : undefined}
                />
              ))}
            </motion.div>
          </AnimatePresence>
        )}
        </>}
      </div>

      <div className="flex min-h-10 flex-wrap items-center justify-between gap-2 border-t border-slate-100 bg-slate-50 px-5 py-2 text-[11px] leading-4 text-slate-500">
        <span>{t(coreMode ? "核心配件按 T+ 物料去重，仅展示具体数量，不汇总分类节点库存。" : "点击分类或名称卡片可筛选任务；节点有采购任务后不能修改或删除。")}</span>
        {!coreMode && selected && (
          <div className="flex items-center gap-3">
            {onShowTasks && (
              <button type="button" onClick={() => onShowTasks(activeProductId)} className="cursor-pointer rounded-md bg-indigo-600 px-2.5 py-1 font-semibold text-white transition-colors duration-200 hover:bg-indigo-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400">
                {t("查看筛选任务")} · {selected.taskCount}
              </button>
            )}
            <button type="button" onClick={() => selectNode(null)} className="cursor-pointer font-semibold text-indigo-600 hover:text-indigo-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400">
              {t("清除筛选")}
            </button>
          </div>
        )}
      </div>

      {editor && (
        <TreeEditorDialog
          editor={editor}
          materials={materials}
          productId={activeProductId}
          onClose={() => setEditor(null)}
          onSaved={async (node, deleted) => {
            if (deleted && selected?.id === deleted) onSelect(null);
            else if (node && selected?.id === node.id) onSelect(node);
            setEditor(null);
            await loadTree();
          }}
        />
      )}
    </section>
  );
}

function TreeEditorDialog({
  editor,
  materials,
  productId,
  onClose,
  onSaved,
}: {
  editor: TreeEditor;
  materials: Material[];
  productId: string;
  onClose: () => void;
  onSaved: (node?: ProcTaskTreeNode, deletedId?: string) => Promise<void>;
}) {
  const { t } = useI18n();
  const target = editor.mode === "edit" || editor.mode === "delete" ? editor.node : null;
  const isRoot = editor.mode === "add-root" || (target?.parentId ?? null) === null;
  const [name, setName] = useState(target?.name ?? "");
  const [code, setCode] = useState(target?.code ?? "");
  const [spec, setSpec] = useState(target?.spec ?? "");
  const [materialId, setMaterialId] = useState(target?.materialId ?? "");
  const [materialQuery, setMaterialQuery] = useState("");
  const [saving, setSaving] = useState(false);
  const deferredMaterialQuery = useDeferredValue(materialQuery.trim().toLowerCase());

  const sortedMaterials = useMemo(
    () => [...materials].sort((a, b) => `${a.erpCode} ${a.name}`.localeCompare(`${b.erpCode} ${b.name}`, "zh-CN")),
    [materials],
  );
  const { materialMatchCount, materialOptions } = useMemo(() => {
    const matches = deferredMaterialQuery
      ? sortedMaterials.filter((material) => [
        material.erpCode,
        material.tpInventoryCode,
        material.name,
        material.spec,
      ].some((value) => value?.toLowerCase().includes(deferredMaterialQuery)))
      : sortedMaterials;
    const options = matches.slice(0, MATERIAL_SELECT_LIMIT);
    const selectedMaterial = materialId ? materials.find((material) => material.id === materialId) : null;
    if (selectedMaterial && !options.some((material) => material.id === selectedMaterial.id)) {
      options.unshift(selectedMaterial);
    }
    return { materialMatchCount: matches.length, materialOptions: options };
  }, [deferredMaterialQuery, materialId, materials, sortedMaterials]);

  const title = editor.mode === "add-root" ? t("新增采购分类")
    : editor.mode === "add-child" ? t("在「{name}」下新增名称", { name: editor.parent.name })
    : editor.mode === "delete" ? t("删除节点")
    : isRoot ? t("修改采购分类") : t("修改名称节点");

  const submit = async () => {
    if (editor.mode !== "delete" && !name.trim()) {
      toast.error(t("名称不能为空"));
      return;
    }
    setSaving(true);
    try {
      if (editor.mode === "delete") {
        await deleteProcTaskTreeNode(editor.node.id);
        toast.success(t("节点已删除"));
        await onSaved(undefined, editor.node.id);
      } else if (editor.mode === "add-root") {
        const node = await createProcTaskTreeNode({ productId, name: name.trim() });
        toast.success(t("分类已新增"));
        await onSaved(node);
      } else if (editor.mode === "add-child") {
        const node = await createProcTaskTreeNode({
          productId,
          parentId: editor.parent.id,
          name: name.trim(),
          code: code.trim(),
          spec: spec.trim(),
          materialId,
        });
        toast.success(t("名称节点已新增"));
        await onSaved(node);
      } else {
        const node = await updateProcTaskTreeNode(editor.node.id, {
          name: name.trim(),
          code: code.trim(),
          spec: spec.trim(),
          materialId,
        });
        toast.success(t("节点已更新"));
        await onSaved(node);
      }
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : t("保存失败"));
    } finally {
      setSaving(false);
    }
  };

  if (editor.mode === "delete") {
    const deletingNode = editor.node;
    return (
      <AlertDialog open onOpenChange={(open) => { if (!open && !saving) onClose(); }}>
        <AlertDialogContent className="sm:max-w-md">
          <AlertDialogHeader>
            <span className="mb-1 flex size-10 items-center justify-center rounded-xl bg-red-50 text-red-600">
              <Trash2 className="size-4" />
            </span>
            <AlertDialogTitle className="text-balance text-base text-slate-950">{t("删除节点")}</AlertDialogTitle>
            <AlertDialogDescription className="text-pretty text-sm text-slate-600">
              {t("确认删除「{name}」？", { name: deletingNode.name })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {deletingNode.children.length > 0 && (
            <p className="rounded-lg border border-amber-100 bg-amber-50 px-3 py-2 text-xs text-amber-700">
              {t("该分类下的 {count} 个空名称节点将一起删除。", { count: deletingNode.children.length })}
            </p>
          )}
          <p className="text-pretty text-xs text-slate-400">{t("服务端会再次检查任务数量；只要存在任务，删除就会被拒绝。")}</p>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={saving}>{t("取消")}</AlertDialogCancel>
            <AlertDialogAction
              disabled={saving}
              onClick={(event) => {
                event.preventDefault();
                void submit();
              }}
              className="bg-red-600 text-white hover:bg-red-700"
            >
              {saving && <Loader2 className="size-3.5 animate-spin motion-reduce:animate-none" />}
              {t("确认删除")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    );
  }

  return (
    <Dialog open onOpenChange={(open) => { if (!open && !saving) onClose(); }}>
      <DialogContent className="flex max-h-[calc(100dvh-2rem)] flex-col overflow-hidden p-0 sm:max-w-md">
        <DialogHeader className="shrink-0 border-b border-slate-100 px-5 py-4 pr-12">
          <div className="flex items-center gap-2.5">
            <span className="flex size-9 items-center justify-center rounded-xl bg-indigo-50 text-indigo-600">
              {editor.mode === "edit" ? <Pencil className="size-4" /> : <FolderPlus className="size-4" />}
            </span>
            <div>
              <DialogTitle className="text-balance text-sm text-slate-950">{title}</DialogTitle>
              <DialogDescription className="mt-1 text-pretty text-xs">{t("维护采购分类和名称节点")}</DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="min-h-0 space-y-4 overflow-y-auto px-5 py-5">
          {!isRoot && (
            <div>
              <label htmlFor="proc-system-material-search" className="mb-1.5 block text-xs font-medium text-slate-700">{t("搜索物料")}</label>
              <div className="relative mb-2">
                <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
                <Input
                  id="proc-system-material-search"
                  value={materialQuery}
                  onChange={(event) => setMaterialQuery(event.target.value)}
                  placeholder={t("输入物料编码、名称或规格")}
                  autoComplete="off"
                  className="h-10 w-full rounded-lg border border-slate-200 pl-9 pr-3 text-sm outline-none focus:border-indigo-300 focus:ring-2 focus:ring-indigo-100"
                />
              </div>
              <label htmlFor="proc-system-material" className="mb-1.5 block text-xs font-medium text-slate-700">{t("关联物料（可选）")}</label>
              <Select
                value={materialId || NO_MATERIAL_OPTION}
                onValueChange={(value) => {
                  const id = value === NO_MATERIAL_OPTION ? "" : value;
                  setMaterialId(id);
                  const material = materials.find((item) => item.id === id);
                  if (material) {
                    setName(material.name);
                    setCode(material.tpInventoryCode || material.erpCode || "");
                    setSpec(material.spec || "");
                  }
                }}
              >
                <SelectTrigger
                  id="proc-system-material"
                  className="h-10 w-full rounded-lg border-slate-200 bg-white px-3 text-sm text-slate-700 focus-visible:border-indigo-300 focus-visible:ring-2 focus-visible:ring-indigo-100"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="z-[100] max-h-[min(18rem,var(--radix-select-content-available-height))] max-w-[min(32rem,calc(100vw-2rem))] rounded-xl border border-slate-200 bg-white p-1 shadow-xl motion-reduce:animate-none motion-reduce:transition-none">
                  <SelectItem value={NO_MATERIAL_OPTION}>{t("不关联物料，仅创建目录节点")}</SelectItem>
                  {materialOptions.map((material) => (
                    <SelectItem key={material.id} value={material.id}>
                      {material.erpCode || material.tpInventoryCode || "—"} · {material.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="mt-1.5 text-[11px] text-slate-500" aria-live="polite">
                {materialMatchCount > MATERIAL_SELECT_LIMIT
                  ? t("匹配 {count} 条，当前显示前 {limit} 条，请继续输入以缩小范围", { count: materialMatchCount, limit: MATERIAL_SELECT_LIMIT })
                  : t("匹配 {count} 条物料", { count: materialMatchCount })}
              </p>
            </div>
          )}
          <div>
            <label htmlFor="proc-system-node-name" className="mb-1.5 block text-xs font-medium text-slate-700">{isRoot ? t("分类名称") : t("节点名称")}</label>
            <Input id="proc-system-node-name" autoFocus value={name} onChange={(event) => setName(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void submit(); }} className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-indigo-300 focus:ring-2 focus:ring-indigo-100" />
          </div>
          {!isRoot && (
            <div className="grid grid-cols-2 gap-3">
              <div><label htmlFor="proc-system-code" className="mb-1.5 block text-xs font-medium text-slate-700">{t("物料编码")}</label><Input id="proc-system-code" value={code} onChange={(event) => setCode(event.target.value)} className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-indigo-300 focus:ring-2 focus:ring-indigo-100" /></div>
              <div><label htmlFor="proc-system-spec" className="mb-1.5 block text-xs font-medium text-slate-700">{t("材质 / 型号")}</label><Input id="proc-system-spec" value={spec} onChange={(event) => setSpec(event.target.value)} className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-indigo-300 focus:ring-2 focus:ring-indigo-100" /></div>
            </div>
          )}
        </div>

        <DialogFooter className="shrink-0 border-t border-slate-100 bg-slate-50 px-5 py-3">
          <button type="button" disabled={saving} onClick={onClose} className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50">{t("取消")}</button>
          <button type="button" disabled={saving} onClick={() => void submit()} className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white shadow-sm hover:bg-indigo-700 disabled:opacity-50">
            {saving && <Loader2 className="size-3.5 animate-spin motion-reduce:animate-none" />}
            {t("保存")}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
