import { Button } from "../../components/ui/button";
import { useCallback, useDeferredValue, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
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
  Pencil,
  Plus,
  Search,
  Settings2,
  Trash2,
  X,
} from "lucide-react";
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
import { ScrollArea } from "../../components/ui/scroll-area";
import { Tabs, TabsList, TabsTrigger } from "../../components/ui/tabs";
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
import { ComponentInventoryValue } from "./ComponentInventory";
import { listComponentInventory, type ComponentInventory } from "../../lib/procurementApi";
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
    dot: "bg-rose-500",
    badge: "bg-rose-50 text-rose-700",
    border: "border-rose-200",
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

type NodeMetrics = ReturnType<typeof getNodeMetrics>;

function getTaskDescription(task: ProcurementTask) {
  const detail = task.consumableNote?.trim() || task.rdTaskTitle?.trim() || task.spec.trim();
  return [task.materialName, detail].filter(Boolean).join(" · ");
}

function PanoramaNodeCard({
  isRoot,
  isSelected,
  manageMode,
  metrics,
  node,
  onAddChild,
  onDelete,
  onEdit,
  onSelect,
  stock,
  stockError,
}: {
  isRoot: boolean;
  isSelected: boolean;
  manageMode: boolean;
  metrics: NodeMetrics;
  node: ProcTaskTreeNode;
  onAddChild?: () => void;
  onDelete?: () => void;
  onEdit?: () => void;
  onSelect: () => void;
  stock?: ComponentInventory;
  stockError?: string;
}) {
  const { t } = useI18n();
  const health = NODE_HEALTH_STYLE[metrics.health];
  const locked = node.taskCount > 0;
  const isIdle = metrics.total === 0;

  return (
    <div
      data-idle={isIdle}
      className={cn(
        "proc-horizon-system-card group relative h-full overflow-hidden rounded-xl border bg-white shadow-sm",
        isSelected ? "border-primary/40 ring-2 ring-primary/15" : health.border,
        metrics.health === "idle" && "bg-slate-50/30",
      )}
    >
      <Button variant="unstyled"
        type="button"
        onClick={onSelect}
        aria-label={t(isRoot ? "查看分类：{name}" : "查看模块：{name}", { name: node.name })}
        className={cn(
          "proc-horizon-system-card-content flex h-full w-full flex-col gap-3 p-4 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary/40",
          isIdle ? "min-h-32" : "min-h-44",
          manageMode && "pb-14",
        )}
      >
        <span className={cn("proc-horizon-system-accent absolute inset-x-0 top-0 h-0.5", health.dot)} />
        <span className="proc-horizon-system-card-heading flex w-full flex-wrap items-start gap-2">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-600">
            <Layers3 className="size-4" />
          </span>
          <span className="min-w-0 flex-1 basis-24">
            <span className="line-clamp-2 break-words text-balance text-sm font-semibold text-slate-900" title={node.name}>{node.name}</span>
            <span className="mt-0.5 block truncate text-xs text-slate-500" title={isRoot ? undefined : [node.code, node.spec].filter(Boolean).join(" · ")}>
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
          <span className="mt-auto flex w-full flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-3">
            <span className="inline-flex items-center gap-1 text-xs font-medium text-primary">{t(isRoot ? "查看名称节点" : "查看模块")}<ChevronRight aria-hidden="true" className="size-3.5" /></span>
          </span>
        ) : (
          <>
            <span className="mt-4 flex w-full items-center justify-between gap-2">
              <span className="text-3xl font-semibold tabular-nums text-slate-900">
                {metrics.progress}<span className="text-base text-muted-foreground">%</span>
              </span>
              <span className="flex items-center gap-1.5">
                {metrics.overdue > 0 && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-rose-50 px-2 py-0.5 text-xs font-semibold tabular-nums text-rose-600">
                    <AlertTriangle className="size-3" />
                    {metrics.overdue}
                  </span>
                )}
              </span>
            </span>

            <span role="progressbar" aria-label={t("任务完成进度")} aria-valuemin={0} aria-valuemax={100} aria-valuenow={metrics.progress} className="proc-horizon-task-progress-track mt-2 h-1 w-full overflow-hidden rounded-full bg-slate-100">
              <span className={cn("block h-full rounded-full", health.dot)} style={{ width: `${metrics.progress}%` }} />
            </span>

            {metrics.latestTasks.length > 0 && (
              <span className="mt-3 block w-full rounded-lg bg-slate-50 px-2.5 py-2">
                <span className="mb-1 block text-[11px] font-medium text-slate-500">{t("最新任务")}</span>
                {metrics.latestTasks.map((task) => {
                  const description = getTaskDescription(task);
                  return (
                    <span key={task.id} className="flex min-w-0 items-center gap-1.5 py-0.5 text-xs text-slate-600">
                      <span className="size-1 shrink-0 rounded-full bg-primary" />
                      <span className="min-w-0 flex-1 truncate" title={description}>{description}</span>
                    </span>
                  );
                })}
              </span>
            )}

            <span className="mt-auto flex w-full items-center justify-between pt-3 text-xs text-slate-500">
              <span><strong className="font-semibold tabular-nums text-slate-800">{metrics.total}</strong> {t("任务")}</span>
              <span><strong className="font-semibold tabular-nums text-primary">{metrics.active}</strong> {t("进行中")}</span>
              <span><strong className="font-semibold tabular-nums text-emerald-600">{metrics.completed}</strong> {t("完成")}</span>
            </span>
          </>
        )}
      </Button>

      <div className="border-t border-slate-100 px-4 py-2 text-slate-600"><ComponentInventoryValue stock={stock} error={stockError} grouped={isRoot} /></div>

      {manageMode && (
        <div className="absolute bottom-3 right-3 flex items-center gap-1 rounded-lg border border-slate-200 bg-white p-1 shadow-sm">
          {isRoot && onAddChild && (
            <Button variant="unstyled" type="button" onClick={onAddChild} aria-label={t("新增名称节点")} title={t("新增名称节点")} className="rounded-md p-1.5 text-primary hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40">
              <FolderPlus className="size-3.5" />
            </Button>
          )}
          {onEdit && (
            <Button variant="unstyled"
              type="button"
              disabled={locked}
              onClick={onEdit}
              aria-label={locked ? t("节点已有任务，不能修改") : t("修改节点")}
              title={locked ? t("节点已有任务，不能修改") : t("修改节点")}
              className={cn("rounded-md p-1.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40", locked ? "cursor-not-allowed text-muted-foreground" : "text-slate-500 hover:bg-slate-100 hover:text-slate-800")}
            >
              {locked ? <LockKeyhole className="size-3.5" /> : <Pencil className="size-3.5" />}
            </Button>
          )}
          {onDelete && (
            <Button variant="unstyled"
              type="button"
              disabled={locked}
              onClick={onDelete}
              aria-label={locked ? t("节点已有任务，不能删除") : t("删除节点")}
              title={locked ? t("节点已有任务，不能删除") : t("删除节点")}
              className={cn("rounded-md p-1.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40", locked ? "cursor-not-allowed text-muted-foreground" : "text-slate-500 hover:bg-rose-50 hover:text-rose-600")}
            >
              <Trash2 className="size-3.5" />
            </Button>
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
}) {
  const { t } = useI18n();
  const products = useProcurementProducts();
  const canEdit = usePermission("proc-task:create");
  const canDelete = usePermission("proc-task:delete");
  const canManage = canEdit || canDelete;
  const [roots, setRoots] = useState<ProcTaskTreeNode[]>([]);
  const [componentStocks, setComponentStocks] = useState<ComponentInventory[]>([]);
  const [stockError, setStockError] = useState('');
  const [stockRevision, setStockRevision] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    const collect = (nodes: ProcTaskTreeNode[]): string[] => nodes.flatMap(node => [...(node.materialId ? [node.materialId] : []), ...collect(node.children)]);
    setComponentStocks([]); setStockError('');
    void listComponentInventory(collect(roots), controller.signal).then(rows => { if (!controller.signal.aborted) setComponentStocks(rows); })
      .catch(error => { if (!controller.signal.aborted) setStockError(error instanceof Error ? error.message : '组件库存读取失败'); });
    return () => controller.abort();
  }, [roots, stockRevision]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [keyword, setKeyword] = useState("");
  const [activeProductId, setActiveProductId] = useState(requestedProductId || DEFAULT_PROCUREMENT_PRODUCT_ID);
  const [activeRootId, setActiveRootId] = useState<string | null>(null);
  const [manageMode, setManageMode] = useState(false);
  const [editor, setEditor] = useState<TreeEditor | null>(null);
  const categoryNavRef = useRef<HTMLElement | null>(null);
  const panoramaScrollRef = useRef<HTMLDivElement | null>(null);
  const treeRequestRef = useRef(0);
  const [categoryNavEdges, setCategoryNavEdges] = useState({ left: false, right: false });
  const requestedProductMissing = Boolean(requestedProductId && !products.some((product) => product.id === requestedProductId));

  const taskFingerprint = useMemo(
    () => tasks
      .filter((task) => task.productId === activeProductId)
      .map((task) => `${task.id}:${task.materialId ?? ""}:${task.updatedAt}`)
      .join("|"),
    [activeProductId, tasks],
  );

  const loadTree = useCallback(async () => {
    const requestId = ++treeRequestRef.current;
    if (requestedProductMissing || (requestedProductId && activeProductId !== requestedProductId)) {
      setRoots([]); setLoading(false); setError(null);
      return;
    }
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
  }, [activeProductId, requestedProductId, requestedProductMissing, t]);

  useEffect(() => {
    if (requestedProductId || products.length === 0 || products.some((product) => product.id === activeProductId)) return;
    setActiveProductId(products[0].id);
  }, [activeProductId, products, requestedProductId]);

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
    return () => { treeRequestRef.current += 1; };
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
  const visibleNodeMetrics = useMemo(
    () => new Map(visibleNodes.map((node) => [node.id, getNodeMetrics(node, tasksById)])),
    [tasksById, visibleNodes],
  );
  const legend = useMemo(
    () => {
      const counts = new Map<NodeHealth, number>();
      for (const metrics of visibleNodeMetrics.values()) {
        counts.set(metrics.health, (counts.get(metrics.health) ?? 0) + 1);
      }
      return (Object.keys(NODE_HEALTH_STYLE) as NodeHealth[]).map((health) => ({
        count: counts.get(health) ?? 0,
        health,
      }));
    },
    [visibleNodeMetrics],
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
  }, [updateCategoryNavEdges, visibleRoots, detailNodeId]);

  useLayoutEffect(() => {
    if (panoramaScrollRef.current) panoramaScrollRef.current.scrollTop = 0;
  }, [activeProductId, activeRootId, normalizedKeyword, detailNodeId]);

  const scrollCategoryNav = (direction: -1 | 1) => {
    const nav = categoryNavRef.current;
    if (!nav) return;
    const maxScrollLeft = Math.max(0, nav.scrollWidth - nav.clientWidth);
    const distance = Math.max(240, Math.round(nav.clientWidth * 0.6));
    const target = Math.min(maxScrollLeft, Math.max(0, nav.scrollLeft + direction * distance));
    nav.scrollLeft = target;
  };

  const selectNode = (node: ProcTaskTreeNode | null) => {
    if (node?.parentId && node.children.length === 0 && onOpenModule) {
      onSelect(node);
      setActiveRootId(node.parentId);
      onOpenModule(node, activeProductId);
      return;
    }
    onSelect(node);
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

  if (requestedProductMissing) {
    return <section role="status" className="proc-horizon-system-panorama material-card flex min-h-0 flex-1 items-center justify-center border-slate-200 bg-white px-4 py-8 shadow-sm">
      <div className="max-w-lg text-center">
        <AlertTriangle className="mx-auto size-7 text-amber-600" />
        <p className="mt-2 text-sm font-semibold text-slate-700">{t("原产品不在当前可用列表中，可能已删除或移出。")}</p>
        <p className="mt-1 text-pretty text-xs text-slate-500">{t("请重新选择产品；不会自动打开其他产品的计划。")}</p>
        {onShowTasks ? <Button variant="unstyled" type="button" onClick={() => onShowTasks(requestedProductId || activeProductId)} className="material-button-secondary mt-3 px-3 py-1.5 text-xs">{t("返回任务驾驶舱")}</Button> : null}
      </div>
    </section>;
  }

  if (detailNodeId) {
    if (detailNode) {
      return (
        <ProcurementModuleDetail
          materials={materials}
          node={detailNode}
          parentName={detailParent?.name}
          productName={activeProduct?.name ?? activeProductId}
          tasks={tasks}
          componentStock={componentStocks.find(stock => stock.materialId === detailNode.materialId)}
          stockError={stockError}
          onStockSaved={() => setStockRevision(version => version + 1)}
          onBack={() => onCloseModule?.()}
        />
      );
    }
    return (
      <section className="proc-horizon-system-panorama material-card flex min-h-0 flex-1 items-center justify-center border-slate-200 bg-white shadow-sm">
        {loading ? (
          <div aria-label={t("正在加载模块详情")} className="w-full max-w-2xl space-y-3 px-6">
            <div className="h-6 w-48 rounded bg-slate-100" />
            <div className="h-24 rounded-xl border border-slate-200 bg-slate-50" />
            <div className="h-40 rounded-xl border border-slate-200 bg-slate-50" />
          </div>
        ) : (
          <div role={error ? "alert" : undefined} className="max-w-lg px-4 text-center">
            <AlertTriangle className={cn("mx-auto size-7", error ? "text-rose-500" : "text-muted-foreground")} />
            <p className={cn("mt-2 text-sm font-semibold", error ? "text-rose-700" : "text-slate-600")}>{error ? t("模块详情加载失败") : t("模块不存在或已被删除")}</p>
            {error ? <p className="mt-1 text-pretty text-xs text-rose-600">{error}</p> : null}
            <div className="mt-3 flex items-center justify-center gap-2">
              {error ? <Button variant="unstyled" type="button" onClick={() => void loadTree()} className="material-button-secondary px-3 py-1.5 text-xs">{t("重新加载")}</Button> : null}
              <Button variant="unstyled" type="button" onClick={() => onCloseModule?.()} className="material-button-secondary px-3 py-1.5 text-xs">{t("返回子系统全景")}</Button>
            </div>
          </div>
        )}
      </section>
    );
  }

  return (
    <section className="proc-horizon-system-panorama material-card flex min-h-0 flex-1 flex-col overflow-hidden border-slate-200 bg-white shadow-sm">
      <header className="proc-horizon-system-header grid items-center gap-3 p-4">
        <div className="proc-horizon-system-views flex min-w-0 flex-wrap items-center gap-3">
          {onShowTasks && (
            <Button variant="unstyled"
              type="button"
              onClick={() => onShowTasks(activeProductId)}
              className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-[var(--primary-soft-border)] bg-accent px-3 text-xs font-semibold text-primary hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
            >
              <LayoutDashboard className="size-3.5" />
              {t("返回任务驾驶舱")}
            </Button>
          )}
        </div>

        <div className="proc-horizon-system-tools flex min-w-0 flex-wrap items-center gap-2">
          <div className="proc-horizon-system-search flex min-w-0 flex-1 items-center gap-2 rounded-lg border border-slate-200 bg-slate-50/80 px-3 focus-within:border-primary/40 focus-within:bg-white focus-within:ring-2 focus-within:ring-primary/15">
            <Search className="size-3.5 text-muted-foreground" />
            <Input
              value={keyword}
              onChange={(event) => setKeyword(event.target.value)}
              aria-label={t("搜索采购分类与名称节点")}
              placeholder={t("搜索分类 / 名称 / 编码")}
              className="h-9 min-w-0 w-full border-0 bg-transparent p-0 text-xs shadow-none outline-none focus-visible:ring-0"
            />
            {keyword && (
              <Button variant="unstyled" type="button" onClick={() => setKeyword("")} aria-label={t("清空搜索")} className="flex size-6 items-center justify-center rounded-md text-muted-foreground hover:bg-slate-100 hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40">
                <X className="size-3" />
              </Button>
            )}
          </div>
          {canManage && (
            <>
              {manageMode && canEdit && (
                <Button variant="unstyled" type="button" onClick={() => setEditor({ mode: "add-root" })} className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--primary-soft-border)] bg-accent px-3 py-1.5 text-xs font-semibold text-primary hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40">
                  <Plus className="size-3.5" />
                  {t("新增分类")}
                </Button>
              )}
              <Button variant="unstyled"
                type="button"
                onClick={() => setManageMode((current) => !current)}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40",
                  manageMode ? "border-[var(--primary-soft-border)] bg-accent text-primary" : "border-slate-200 bg-slate-50 text-slate-600 hover:border-[var(--primary-soft-border)] hover:text-primary",
                )}
              >
                <Settings2 className="size-3.5" />
                {manageMode ? t("完成管理") : t("管理分类")}
              </Button>
            </>
          )}
        </div>
          {!loading && !error && visibleNodes.length > 0 && (
            <div className="proc-horizon-system-legend flex flex-wrap items-center gap-1.5">
              {legend.filter(({ count }) => count > 0).map(({ count, health }) => {
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
      </header>

      <Tabs value={activeProductId} onValueChange={selectProduct} className="proc-horizon-system-products min-w-0 shrink-0 gap-0 border-y border-slate-100 bg-white px-4">
        <ScrollArea scrollbars="horizontal" className="w-full">
          <TabsList aria-label={t("采购产品系统")} className="h-12 min-w-max gap-1 rounded-none bg-transparent p-0">
          {products.map((product) => {
            const isActive = product.id === activeProductId;
            const dot = product.status === "active"
              ? "bg-emerald-500"
              : product.status === "paused"
                ? "bg-amber-500"
                : product.status === "archived"
                  ? "bg-slate-400"
                  : "bg-primary";
            return (
              <TabsTrigger
                key={product.id}
                value={product.id}
                className={cn(
                  "relative h-12 flex-none gap-2 rounded-none border-0 bg-transparent px-4 text-sm font-semibold shadow-none data-[state=active]:bg-transparent data-[state=active]:shadow-none",
                  isActive ? "text-primary" : "text-slate-500 hover:bg-slate-50 hover:text-slate-800",
                )}
              >
                <span className={cn("size-2 rounded-full", dot)} />
                <span className="max-w-56 truncate" title={t(product.name)}>{t(product.name)}</span>
                {isActive && <span aria-hidden="true" className="absolute inset-x-3 bottom-0 h-0.5 rounded-full bg-primary" />}
              </TabsTrigger>
            );
          })}
          </TabsList>
        </ScrollArea>
      </Tabs>

      <div className="relative min-w-0 shrink-0 border-b border-slate-100 bg-slate-50/80 px-11 py-2">
        <Button variant="unstyled"
          type="button"
          onClick={() => scrollCategoryNav(-1)}
          disabled={!categoryNavEdges.left}
          aria-label={t("向左浏览采购分类")}
          className="absolute left-2 top-1/2 z-10 flex size-7 -translate-y-1/2 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-500 shadow-sm hover:border-[var(--primary-soft-border)] hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 disabled:pointer-events-none disabled:opacity-30"
        >
          <ChevronLeft className="size-4" />
        </Button>

        <nav
          ref={categoryNavRef}
          onScroll={updateCategoryNavEdges}
          className="flex gap-1.5 overflow-x-auto [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          aria-label={t("采购分类")}
        >
          <Button variant="unstyled"
            type="button"
            aria-pressed={!activeRoot}
            onClick={() => selectNode(null)}
            className={cn(
              "relative isolate flex shrink-0 items-center rounded-lg border border-transparent px-3 py-1.5 text-xs font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40",
              !activeRoot
                ? "text-primary"
                : "text-slate-600 hover:border-slate-200 hover:bg-white hover:text-slate-900",
            )}
          >
            {!activeRoot && <span aria-hidden="true" className="absolute inset-0 z-0 rounded-lg border border-[var(--primary-soft-border)] bg-white shadow-sm" />}
            <span className="relative z-10 flex items-center gap-2">
              {t("全部分类")}
              <span className={cn(
                "rounded-full px-1.5 text-[11px] tabular-nums",
                !activeRoot ? "bg-accent text-primary" : "bg-slate-200/70 text-slate-500",
              )}>
                {visibleRoots.length}
              </span>
            </span>
          </Button>
          {visibleRoots.map((root) => {
            const isActive = activeRoot?.id === root.id;
            return (
              <Button variant="unstyled"
                key={root.id}
                type="button"
                aria-pressed={isActive}
                onClick={() => selectNode(root)}
                className={cn(
                  "relative isolate flex shrink-0 items-center rounded-lg border border-transparent px-3 py-1.5 text-xs font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40",
                  isActive
                    ? "text-primary"
                    : "text-slate-600 hover:border-slate-200 hover:bg-white hover:text-slate-900",
                )}
              >
                {isActive && <span aria-hidden="true" className="absolute inset-0 z-0 rounded-lg border border-[var(--primary-soft-border)] bg-white shadow-sm" />}
                <span className="relative z-10 flex items-center gap-2">
                  <span className={cn("size-1.5 rounded-full", root.taskCount > 0 ? "bg-primary" : "bg-slate-300")} />
                  <span className="max-w-40 truncate" title={root.name}>{root.name}</span>
                  <span className={cn(
                    "rounded-full px-1.5 text-[11px] tabular-nums",
                    isActive ? "bg-accent text-primary" : "bg-slate-200/70 text-slate-500",
                  )}>
                    {root.taskCount}
                  </span>
                </span>
              </Button>
            );
          })}
        </nav>

        <Button variant="unstyled"
          type="button"
          onClick={() => scrollCategoryNav(1)}
          disabled={!categoryNavEdges.right}
          aria-label={t("向右浏览采购分类")}
          className="absolute right-2 top-1/2 z-10 flex size-7 -translate-y-1/2 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-500 shadow-sm hover:border-[var(--primary-soft-border)] hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 disabled:pointer-events-none disabled:opacity-30"
        >
          <ChevronRight className="size-4" />
        </Button>
      </div>

      <div ref={panoramaScrollRef} className="proc-horizon-system-body min-h-0 flex-1 overflow-y-auto p-4">
        {activeRoot && canManage && manageMode && (
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[var(--primary-soft-border)] bg-accent px-3 py-2">
            <div className="min-w-0">
              <p className="truncate text-xs font-semibold text-primary-hover">{activeRoot.name}</p>
              <p className="text-[11px] tabular-nums text-primary">{t("当前分类 · {count} 个名称节点", { count: activeRoot.children.length })}</p>
            </div>
            <div className="flex items-center gap-1">
              {canEdit && (
                <>
                  <Button variant="unstyled" type="button" onClick={() => setEditor({ mode: "add-child", parent: activeRoot })} className="inline-flex items-center gap-1 rounded-md bg-white px-2 py-1.5 text-[11px] font-semibold text-primary shadow-sm hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40">
                    <FolderPlus className="size-3.5" />
                    {t("新增名称")}
                  </Button>
                  <Button variant="unstyled"
                    type="button"
                    disabled={activeRoot.taskCount > 0}
                    onClick={() => activeRoot.taskCount === 0 && setEditor({ mode: "edit", node: activeRoot })}
                    aria-label={activeRoot.taskCount > 0 ? t("节点已有任务，不能修改") : t("修改分类")}
                    title={activeRoot.taskCount > 0 ? t("节点已有任务，不能修改") : t("修改分类")}
                    className={cn("rounded-md bg-white p-1.5 shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40", activeRoot.taskCount > 0 ? "cursor-not-allowed text-muted-foreground" : "text-slate-500 hover:text-slate-800")}
                  >
                    {activeRoot.taskCount > 0 ? <LockKeyhole className="size-3.5" /> : <Pencil className="size-3.5" />}
                  </Button>
                </>
              )}
              {canDelete && (
                <Button variant="unstyled"
                  type="button"
                  disabled={activeRoot.taskCount > 0}
                  onClick={() => activeRoot.taskCount === 0 && setEditor({ mode: "delete", node: activeRoot })}
                  aria-label={activeRoot.taskCount > 0 ? t("节点已有任务，不能删除") : t("删除分类")}
                  title={activeRoot.taskCount > 0 ? t("节点已有任务，不能删除") : t("删除分类")}
                  className={cn("rounded-md bg-white p-1.5 shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40", activeRoot.taskCount > 0 ? "cursor-not-allowed text-muted-foreground" : "text-slate-500 hover:text-rose-600")}
                >
                  <Trash2 className="size-3.5" />
                </Button>
              )}
            </div>
          </div>
        )}
        {loading && roots.length === 0 ? (
          <div aria-label={t("正在加载系统全景")} className="proc-horizon-system-grid grid gap-3">
            {[0, 1, 2].map((item) => (
              <div key={item} className="min-h-44 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                <div className="flex items-center gap-3"><span className="size-8 rounded-lg bg-slate-100" /><span className="h-4 w-32 rounded bg-slate-100" /></div>
                <div className="mt-5 h-8 w-20 rounded bg-slate-100" />
                <div className="mt-3 h-2 w-full rounded bg-slate-100" />
                <div className="mt-6 h-4 w-2/3 rounded bg-slate-100" />
              </div>
            ))}
          </div>
        ) : error ? (
          <div role="alert" className="flex flex-col items-center rounded-lg border border-dashed border-rose-200 bg-rose-50 px-4 py-8 text-center">
            <AlertTriangle className="size-7 text-rose-500" />
            <p className="mt-2 text-sm font-semibold text-rose-700">{t("系统全景加载失败")}</p>
            <p className="mt-1 max-w-xl text-pretty text-xs text-rose-600">{error}</p>
            <Button variant="unstyled" type="button" onClick={() => void loadTree()} className="material-button-secondary mt-3 px-3 py-1.5 text-xs">{t("重新加载")}</Button>
          </div>
        ) : visibleNodes.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-slate-200 bg-slate-50 px-4 py-10 text-center">
            <Layers3 className="mb-2 size-7 text-muted-foreground" />
            <p className="text-sm font-medium text-slate-500">{normalizedKeyword ? t("没有匹配的节点") : activeRoot ? t("该分类暂无名称节点") : t("暂无采购分类")}</p>
            {normalizedKeyword ? (
              <Button variant="unstyled" type="button" onClick={() => setKeyword("")} className="material-button-secondary mt-3 px-3 py-1.5 text-xs">{t("清空搜索")}</Button>
            ) : canEdit ? (
              <Button variant="unstyled" type="button" onClick={() => setEditor(activeRoot ? { mode: "add-child", parent: activeRoot } : { mode: "add-root" })} className="mt-3 inline-flex items-center gap-1.5 rounded-lg border border-[var(--primary-soft-border)] bg-white px-3 py-1.5 text-xs font-semibold text-primary hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40">
                <Plus className="size-3.5" />
                {activeRoot ? t("新增名称节点") : t("新增分类")}
              </Button>
            ) : null}
          </div>
        ) : (
          <div key={activeRoot?.id ?? "all-categories"} className="proc-horizon-system-grid grid gap-3">
            {visibleNodes.map((node) => (
                <PanoramaNodeCard
                  key={node.id}
                  node={node}
                  metrics={visibleNodeMetrics.get(node.id)!}
                  isRoot={!activeRoot}
                  isSelected={selected?.id === node.id}
                  manageMode={canManage && manageMode}
                  stock={componentStocks.find(stock => stock.materialId === node.materialId)}
                  stockError={stockError}
                  onSelect={() => selectNode(node)}
                  onAddChild={canEdit && !activeRoot ? () => setEditor({ mode: "add-child", parent: node }) : undefined}
                  onEdit={canEdit ? () => node.taskCount === 0 && setEditor({ mode: "edit", node }) : undefined}
                  onDelete={canDelete ? () => node.taskCount === 0 && setEditor({ mode: "delete", node }) : undefined}
                />
            ))}
          </div>
        )}
      </div>

      <div className="proc-horizon-system-footer flex min-h-10 shrink-0 flex-wrap items-center justify-between gap-2 border-t border-slate-100 bg-slate-50 px-4 py-2 text-[11px] leading-4 text-slate-500">
        <span className="text-pretty">{t("选择分类查看名称节点，点击名称节点打开模块详情。")}{manageMode ? ` ${t("已有任务的节点无法修改或删除。")}` : ""}</span>
        {selected && (
          <div className="flex items-center gap-3">
            {onShowTasks && (
              <Button type="button" onClick={() => onShowTasks(activeProductId)} className="cursor-pointer rounded-md px-2.5 py-1 font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40">
                {t("查看筛选任务")} · {selected.taskCount}
              </Button>
            )}
            <Button variant="unstyled" type="button" onClick={() => selectNode(null)} className="cursor-pointer font-semibold text-primary hover:text-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40">
              {t("清除筛选")}
            </Button>
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
  const [saveError, setSaveError] = useState<string | null>(null);
  const deferredMaterialQuery = useDeferredValue(materialQuery.trim().toLowerCase());

  const materialById = useMemo(
    () => new Map(materials.map((material) => [material.id, material])),
    [materials],
  );

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
    const selectedMaterial = materialId ? materialById.get(materialId) : null;
    if (selectedMaterial && !options.some((material) => material.id === selectedMaterial.id)) {
      options.unshift(selectedMaterial);
    }
    return { materialMatchCount: matches.length, materialOptions: options };
  }, [deferredMaterialQuery, materialById, materialId, sortedMaterials]);

  const title = editor.mode === "add-root" ? t("新增采购分类")
    : editor.mode === "add-child" ? t("在「{name}」下新增名称", { name: editor.parent.name })
    : editor.mode === "delete" ? t("删除节点")
    : isRoot ? t("修改采购分类") : t("修改名称节点");

  const submit = async () => {
    if (saving) return;
    if (editor.mode !== "delete" && !name.trim()) {
      const message = t("名称不能为空");
      setSaveError(message);
      toast.error(message);
      return;
    }
    setSaving(true);
    setSaveError(null);
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
      const message = cause instanceof Error ? cause.message : t("保存失败");
      setSaveError(message);
      toast.error(message);
    } finally {
      setSaving(false);
    }
  };

  if (editor.mode === "delete") {
    const deletingNode = editor.node;
    return (
      <AlertDialog open onOpenChange={(open) => { if (!open && !saving) onClose(); }}>
        <AlertDialogContent className="horizon-theme horizon-portal proc-horizon-overlay sm:max-w-md">
          <AlertDialogHeader>
            <span className="mb-1 flex size-10 items-center justify-center rounded-xl bg-rose-50 text-rose-600">
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
          <p className="text-pretty text-xs text-muted-foreground">{t("服务端会再次检查任务数量；只要存在任务，删除就会被拒绝。")}</p>
          {saveError ? <p role="alert" className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-pretty text-xs text-rose-700">{saveError}</p> : null}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={saving}>{t("取消")}</AlertDialogCancel>
            <AlertDialogAction
              disabled={saving}
              onClick={(event) => {
                event.preventDefault();
                void submit();
              }}
              className="bg-rose-600 text-white hover:bg-rose-700"
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
      <DialogContent className="horizon-theme horizon-portal proc-horizon-overlay flex max-h-[calc(100dvh-2rem)] flex-col overflow-hidden p-0 sm:max-w-md">
        <DialogHeader className="shrink-0 border-b border-slate-100 px-5 py-4 pr-12">
          <div className="flex items-center gap-2.5">
            <span className="flex size-9 items-center justify-center rounded-xl bg-accent text-primary">
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
                <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  id="proc-system-material-search"
                  value={materialQuery}
                  onChange={(event) => setMaterialQuery(event.target.value)}
                  placeholder={t("输入物料编码、名称或规格")}
                  autoComplete="off"
                  className="h-10 w-full rounded-lg border border-slate-200 pl-9 pr-3 text-sm outline-none focus:border-primary/40 focus:ring-2 focus:ring-primary/15"
                />
              </div>
              <label htmlFor="proc-system-material" className="mb-1.5 block text-xs font-medium text-slate-700">{t("关联物料（可选）")}</label>
              <Select
                value={materialId || NO_MATERIAL_OPTION}
                onValueChange={(value) => {
                  const id = value === NO_MATERIAL_OPTION ? "" : value;
                  setMaterialId(id);
                  const material = materialById.get(id);
                  if (material) {
                    setName(material.name);
                    setCode(material.tpInventoryCode || material.erpCode || "");
                    setSpec(material.spec || "");
                  }
                }}
              >
                <SelectTrigger
                  id="proc-system-material"
                  className="h-10 w-full rounded-lg border-slate-200 bg-white px-3 text-sm text-slate-700 focus-visible:border-primary/40 focus-visible:ring-2 focus-visible:ring-primary/15"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="z-50 max-h-[min(18rem,var(--radix-select-content-available-height))] max-w-[min(32rem,calc(100vw-2rem))] rounded-xl border border-slate-200 bg-white p-1 shadow-xl motion-reduce:animate-none motion-reduce:transition-none">
                  <SelectItem value={NO_MATERIAL_OPTION}>{t("不关联物料，仅创建目录节点")}</SelectItem>
                  {materialOptions.map((material) => (
                    <SelectItem key={material.id} value={material.id}>
                      {material.erpCode || material.tpInventoryCode || "—"} · {material.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="mt-1.5 text-[11px] tabular-nums text-slate-500" aria-live="polite">
                {materialMatchCount > MATERIAL_SELECT_LIMIT
                  ? t("匹配 {count} 条，当前显示前 {limit} 条，请继续输入以缩小范围", { count: materialMatchCount, limit: MATERIAL_SELECT_LIMIT })
                  : t("匹配 {count} 条物料", { count: materialMatchCount })}
              </p>
            </div>
          )}
          <div>
            <label htmlFor="proc-system-node-name" className="mb-1.5 block text-xs font-medium text-slate-700">{isRoot ? t("分类名称") : t("节点名称")}</label>
            <Input id="proc-system-node-name" autoFocus required aria-invalid={Boolean(saveError && !name.trim())} disabled={saving} value={name} onChange={(event) => { setName(event.target.value); if (saveError) setSaveError(null); }} onKeyDown={(event) => { if (event.key === "Enter") void submit(); }} className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-primary/40 focus:ring-2 focus:ring-primary/15" />
          </div>
          {!isRoot && (
            <div className="grid grid-cols-2 gap-3">
              <div><label htmlFor="proc-system-code" className="mb-1.5 block text-xs font-medium text-slate-700">{t("物料编码")}</label><Input id="proc-system-code" value={code} onChange={(event) => setCode(event.target.value)} className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm tabular-nums outline-none focus:border-primary/40 focus:ring-2 focus:ring-primary/15" /></div>
              <div><label htmlFor="proc-system-spec" className="mb-1.5 block text-xs font-medium text-slate-700">{t("材质 / 型号")}</label><Input id="proc-system-spec" value={spec} onChange={(event) => setSpec(event.target.value)} className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-primary/40 focus:ring-2 focus:ring-primary/15" /></div>
            </div>
          )}
        </div>

        {saveError ? <p role="alert" className="mx-5 mb-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-pretty text-xs text-rose-700">{saveError}</p> : null}

        <DialogFooter className="shrink-0 border-t border-slate-100 bg-slate-50 px-5 py-3">
          <Button variant="unstyled" type="button" disabled={saving} onClick={onClose} className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 disabled:opacity-50">{t("取消")}</Button>
          <Button type="button" disabled={saving} onClick={() => void submit()} className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 disabled:opacity-50">
            {saving && <Loader2 className="size-3.5 animate-spin motion-reduce:animate-none" />}
            {t("保存")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
