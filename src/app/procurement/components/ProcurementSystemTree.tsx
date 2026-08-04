import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  FolderPlus,
  Layers3,
  Loader2,
  LockKeyhole,
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
import { cn } from "../../components/ui/utils";
import { usePermission } from "../../hooks/usePermission";
import { useI18n } from "../../lib/i18n";
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

function getNodeMetrics(node: ProcTaskTreeNode, tasksById: Map<string, ProcurementTask>) {
  const nodeTasks = node.taskIds.flatMap((id) => {
    const task = tasksById.get(id);
    return task ? [task] : [];
  });
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

  return { active, completed, health, overdue, progress, total };
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
  tasksById: Map<string, ProcurementTask>;
}) {
  const { t } = useI18n();
  const metrics = getNodeMetrics(node, tasksById);
  const health = NODE_HEALTH_STYLE[metrics.health];
  const locked = node.taskCount > 0;

  return (
    <div
      className={cn(
        "group relative overflow-hidden rounded-xl border bg-white shadow-sm transition-colors",
        isSelected ? "border-indigo-300 ring-2 ring-indigo-100" : health.border,
        metrics.health === "idle" && "opacity-70 hover:opacity-100",
      )}
    >
      <button
        type="button"
        onClick={onSelect}
        className={cn(
          "flex min-h-36 w-full flex-col p-4 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-400",
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
            <span className="mt-0.5 block truncate text-[11px] text-slate-400">
              {isRoot
                ? t("{count} 个名称节点", { count: node.children.length })
                : [node.code, node.spec].filter(Boolean).join(" · ") || t("未设置编码与规格")}
            </span>
          </span>
          <span className={cn("inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold", health.badge)}>
            <span className={cn("size-1 rounded-full", health.dot)} />
            {t(health.label)}
          </span>
        </span>

        <span className="mt-4 flex w-full items-baseline justify-between">
          <span className="text-3xl font-semibold tabular-nums text-slate-900">
            {metrics.progress}<span className="text-base text-slate-400">%</span>
          </span>
          {metrics.overdue > 0 && (
            <span className="inline-flex items-center gap-1 rounded-full bg-red-50 px-2 py-0.5 text-xs font-semibold tabular-nums text-red-600">
              <AlertTriangle className="size-3" />
              {metrics.overdue}
            </span>
          )}
        </span>

        <span className="mt-2 h-1 w-full overflow-hidden rounded-full bg-slate-100">
          <span className={cn("block h-full rounded-full", metrics.health === "idle" ? "bg-slate-200" : health.dot)} style={{ width: `${metrics.progress}%` }} />
        </span>

        <span className="mt-3 flex w-full items-center justify-between text-[11px] text-slate-500">
          <span><strong className="font-semibold tabular-nums text-slate-800">{metrics.total}</strong> {t("任务")}</span>
          <span><strong className="font-semibold tabular-nums text-indigo-600">{metrics.active}</strong> {t("进行中")}</span>
          <span><strong className="font-semibold tabular-nums text-emerald-600">{metrics.completed}</strong> {t("完成")}</span>
        </span>
      </button>

      {manageMode && (
        <div className="absolute bottom-3 right-3 flex items-center gap-1 rounded-lg border border-slate-200 bg-white p-1 shadow-sm">
          {isRoot && onAddChild && (
            <button type="button" onClick={onAddChild} aria-label={t("新增名称节点")} title={t("新增名称节点")} className="rounded-md p-1.5 text-indigo-600 hover:bg-indigo-50">
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
              className={cn("rounded-md p-1.5", locked ? "cursor-not-allowed text-slate-300" : "text-slate-500 hover:bg-slate-100 hover:text-slate-800")}
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
              className={cn("rounded-md p-1.5", locked ? "cursor-not-allowed text-slate-300" : "text-slate-500 hover:bg-red-50 hover:text-red-600")}
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
}: {
  tasks: ProcurementTask[];
  materials: Material[];
  selected: ProcTaskTreeNode | null;
  onSelect: (node: ProcTaskTreeNode | null) => void;
  onShowTasks?: () => void;
}) {
  const { t } = useI18n();
  const canEdit = usePermission("proc-task:create");
  const canDelete = usePermission("proc-task:delete");
  const canManage = canEdit || canDelete;
  const [roots, setRoots] = useState<ProcTaskTreeNode[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [keyword, setKeyword] = useState("");
  const [activeRootId, setActiveRootId] = useState<string | null>(null);
  const [manageMode, setManageMode] = useState(false);
  const [editor, setEditor] = useState<TreeEditor | null>(null);

  const taskFingerprint = useMemo(
    () => tasks.map((task) => `${task.id}:${task.materialId ?? ""}:${task.updatedAt}`).join("|"),
    [tasks],
  );

  const loadTree = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await listProcTaskTree();
      setRoots(data.roots);
      setActiveRootId((current) => current && data.roots.some((root) => root.id === current) ? current : null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("系统树加载失败"));
    } finally {
      setLoading(false);
    }
  }, [t]);

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
  const tasksById = useMemo(() => new Map(tasks.map((task) => [task.id, task])), [tasks]);
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

  const selectNode = (node: ProcTaskTreeNode | null) => {
    onSelect(selected?.id === node?.id ? null : node);
    if (!node) setActiveRootId(null);
    else setActiveRootId(node.parentId ?? node.id);
  };

  return (
    <section className="material-card flex min-h-0 flex-1 flex-col overflow-hidden border-slate-200 bg-white shadow-sm">
      <header className="flex flex-wrap items-start justify-between gap-4 px-5 pb-4 pt-5">
        <div>
          <div className="flex items-center gap-2">
            <span className="flex size-8 items-center justify-center rounded-lg bg-slate-900 text-white shadow-sm">
              <Layers3 className="size-4" />
            </span>
            <div>
              <h2 className="text-balance text-sm font-semibold text-slate-950">{t("采购子系统全景")}</h2>
              <p className="mt-0.5 text-pretty text-xs text-slate-500">
                {activeRoot
                  ? t("{name} · {count} 个名称节点", { name: activeRoot.name, count: activeRoot.children.length })
                  : t("采购分类树 · {count} 个分类", { count: visibleRoots.length })}
              </p>
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-end gap-2">
          {!loading && !error && visibleNodes.length > 0 && (
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
          <div className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 focus-within:border-indigo-300 focus-within:ring-2 focus-within:ring-indigo-100">
            <Search className="size-3.5 text-slate-400" />
            <Input
              value={keyword}
              onChange={(event) => setKeyword(event.target.value)}
              placeholder={t("搜索分类 / 名称 / 编码")}
              className="w-44 border-0 bg-transparent p-0 text-xs shadow-none outline-none focus-visible:ring-0"
            />
            {keyword && (
              <button type="button" onClick={() => setKeyword("")} aria-label={t("清空搜索")} className="rounded text-slate-400 hover:text-slate-700">
                <X className="size-3" />
              </button>
            )}
          </div>
          {canManage && (
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

      <nav className="flex gap-1 overflow-x-auto border-b border-slate-100 px-5" aria-label={t("采购分类") }>
        <button
          type="button"
          onClick={() => selectNode(null)}
          className={cn(
            "flex shrink-0 items-center gap-2 border-b-2 px-3 py-2 text-xs font-semibold",
            !activeRoot ? "border-indigo-500 text-indigo-700" : "border-transparent text-slate-500 hover:bg-slate-50 hover:text-slate-700",
          )}
        >
          {t("全部分类")}
          <span className="rounded-full bg-slate-100 px-1.5 text-[10px] tabular-nums text-slate-500">{visibleRoots.length}</span>
        </button>
        {visibleRoots.map((root) => (
          <button
            key={root.id}
            type="button"
            onClick={() => selectNode(root)}
            className={cn(
              "flex shrink-0 items-center gap-2 border-b-2 px-3 py-2 text-xs font-semibold",
              activeRoot?.id === root.id ? "border-indigo-500 text-indigo-700" : "border-transparent text-slate-500 hover:bg-slate-50 hover:text-slate-700",
            )}
          >
            <span className={cn("size-1.5 rounded-full", root.taskCount > 0 ? "bg-indigo-500" : "bg-slate-300")} />
            <span className="max-w-36 truncate">{root.name}</span>
            <span className="rounded-full bg-slate-100 px-1.5 text-[10px] tabular-nums text-slate-500">{root.taskCount}</span>
          </button>
        ))}
      </nav>

      <div className="min-h-0 flex-1 overflow-y-auto p-5">
        {activeRoot && canManage && manageMode && (
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-indigo-100 bg-indigo-50 px-3 py-2">
            <div className="min-w-0">
              <p className="truncate text-xs font-semibold text-indigo-900">{activeRoot.name}</p>
              <p className="text-[10px] text-indigo-600">{t("当前分类 · {count} 个名称节点", { count: activeRoot.children.length })}</p>
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
          <div className="flex items-center justify-center gap-2 py-12 text-xs text-slate-400"><Loader2 className="size-4 animate-spin" />{t("加载系统全景…")}</div>
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
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
            {visibleNodes.map((node) => (
              <PanoramaNodeCard
                key={node.id}
                node={node}
                isRoot={!activeRoot}
                isSelected={selected?.id === node.id}
                manageMode={canManage && manageMode}
                tasksById={tasksById}
                onSelect={() => selectNode(node)}
                onAddChild={canEdit && !activeRoot ? () => setEditor({ mode: "add-child", parent: node }) : undefined}
                onEdit={canEdit ? () => node.taskCount === 0 && setEditor({ mode: "edit", node }) : undefined}
                onDelete={canDelete ? () => node.taskCount === 0 && setEditor({ mode: "delete", node }) : undefined}
              />
            ))}
          </div>
        )}
      </div>

      <div className="flex min-h-10 flex-wrap items-center justify-between gap-2 border-t border-slate-100 bg-slate-50 px-5 py-2 text-[10px] leading-4 text-slate-500">
        <span>{t("点击分类或名称卡片可筛选任务；节点有采购任务后不能修改或删除。")}</span>
        {selected && (
          <div className="flex items-center gap-3">
            {onShowTasks && (
              <button type="button" onClick={onShowTasks} className="cursor-pointer rounded-md bg-indigo-600 px-2.5 py-1 font-semibold text-white transition-colors duration-200 hover:bg-indigo-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400">
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
  onClose,
  onSaved,
}: {
  editor: TreeEditor;
  materials: Material[];
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
  const [saving, setSaving] = useState(false);

  const materialOptions = useMemo(
    () => [...materials].sort((a, b) => `${a.erpCode} ${a.name}`.localeCompare(`${b.erpCode} ${b.name}`, "zh-CN")),
    [materials],
  );

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
        const node = await createProcTaskTreeNode({ name: name.trim() });
        toast.success(t("分类已新增"));
        await onSaved(node);
      } else if (editor.mode === "add-child") {
        const node = await createProcTaskTreeNode({
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
              {saving && <Loader2 className="size-3.5 animate-spin" />}
              {t("确认删除")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    );
  }

  return (
    <Dialog open onOpenChange={(open) => { if (!open && !saving) onClose(); }}>
      <DialogContent className="overflow-hidden p-0 sm:max-w-md">
        <DialogHeader className="border-b border-slate-100 px-5 py-4 pr-12">
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

        <div className="space-y-4 px-5 py-5">
          {!isRoot && (
            <div>
              <label className="mb-1.5 block text-xs font-medium text-slate-700">{t("关联物料（可选）")}</label>
              <select
                value={materialId}
                onChange={(event) => {
                  const id = event.target.value;
                  setMaterialId(id);
                  const material = materials.find((item) => item.id === id);
                  if (material) {
                    setName(material.name);
                    setCode(material.tpInventoryCode || material.erpCode || "");
                    setSpec(material.spec || "");
                  }
                }}
                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 outline-none focus:border-indigo-300 focus:ring-2 focus:ring-indigo-100"
              >
                <option value="">{t("不关联物料，仅创建目录节点")}</option>
                {materialOptions.map((material) => <option key={material.id} value={material.id}>{material.erpCode || material.tpInventoryCode || "—"} · {material.name}</option>)}
              </select>
            </div>
          )}
          <div>
            <label className="mb-1.5 block text-xs font-medium text-slate-700">{isRoot ? t("分类名称") : t("节点名称")}</label>
            <Input autoFocus value={name} onChange={(event) => setName(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void submit(); }} className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-indigo-300 focus:ring-2 focus:ring-indigo-100" />
          </div>
          {!isRoot && (
            <div className="grid grid-cols-2 gap-3">
              <div><label className="mb-1.5 block text-xs font-medium text-slate-700">{t("物料编码")}</label><Input value={code} onChange={(event) => setCode(event.target.value)} className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-indigo-300 focus:ring-2 focus:ring-indigo-100" /></div>
              <div><label className="mb-1.5 block text-xs font-medium text-slate-700">{t("材质 / 型号")}</label><Input value={spec} onChange={(event) => setSpec(event.target.value)} className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-indigo-300 focus:ring-2 focus:ring-indigo-100" /></div>
            </div>
          )}
        </div>

        <DialogFooter className="border-t border-slate-100 bg-slate-50 px-5 py-3">
          <button type="button" disabled={saving} onClick={onClose} className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50">{t("取消")}</button>
          <button type="button" disabled={saving} onClick={() => void submit()} className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white shadow-sm hover:bg-indigo-700 disabled:opacity-50">
            {saving && <Loader2 className="size-3.5 animate-spin" />}
            {t("保存")}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
