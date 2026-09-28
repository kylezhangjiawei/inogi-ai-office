import { type SubProject, type Category } from "./taskModel";
import { RD_FAST_TRANSITION, RD_LIST_TRANSITION, RD_PANEL_TRANSITION } from "./taskMotion";
import { useEffect, useState, useMemo } from "react";
import { motion, useReducedMotion } from "motion/react";
import {
  AlertTriangle,
  ArrowRight,
  ChevronRight,
  FolderPlus,
  LayoutGrid,
  Loader2,
  Pencil,
  Plus,
  Trash2,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { Input } from "../components/ui/input";
import { cn } from "../components/ui/utils";
import { useAuth } from "../auth";
import { Tooltip, TooltipContent, TooltipTrigger } from "../components/ui/tooltip";
import { usePermission, useAnyPermission } from "../hooks/usePermission";
import { PERMISSIONS } from "../lib/permissions";
import { isProductionWorkspace, isDefaultSubProject } from "../lib/rdApi";
import { t } from "../lib/i18n";
import { type CatStat, type Risk } from "../lib/rdCockpitMetrics";
import { Button } from "../components/ui/button";
import {
  RISK_DOT_COLOR,
  RISK_LABEL,
  getTheme,
  isReservedBomSystem,
  collectTaskIds,
  type CategoryTheme,
} from "./cockpitModel";

/**
 * Tooltip content listing risk tasks. Used by AlertTriangle hover affordances.
 * Shows up to `max` items, with type label + task title + risk reason.
 */
export function RiskListTooltip({
  title,
  risks,
  max = 6,
}: {
  title: string;
  risks: Risk[];
  max?: number;
}) {
  const shown = risks.slice(0, max);
  const hidden = Math.max(0, risks.length - max);
  return (
    <div className="max-w-xs space-y-1.5">
      <div className="flex items-center gap-1.5 text-xs font-semibold">
        <AlertTriangle className="h-3.5 w-3.5 text-red-300" />
        <span>{title}</span>
      </div>
      <ul className="space-y-1 text-[11px]">
        {shown.map((r) => (
          <li key={r.task.task_id + r.type} className="flex items-start gap-1.5">
            <span className={cn("mt-1 h-1.5 w-1.5 shrink-0 rounded-full", RISK_DOT_COLOR[r.type])} />
            <span className="min-w-0 flex-1">
              <span className="font-medium opacity-95">{t(RISK_LABEL[r.type])}</span>
              <span className="opacity-60"> · {r.reason}</span>
              <div className="truncate opacity-80">{r.task.title}</div>
            </span>
          </li>
        ))}
        {hidden > 0 && <li className="text-[11px] opacity-60">{t("…还有 {count} 项", { count: hidden })}</li>}
      </ul>
    </div>
  );
}

export type SystemTreeEditorRequest =
  | { mode: "add-system" }
  | { mode: "edit-system"; category: Category }
  | { mode: "delete-system"; category: Category }
  | { mode: "add-sub"; category: Category }
  | { mode: "edit-sub"; category: Category; sub: SubProject }
  | { mode: "delete-sub"; category: Category; sub: SubProject }
  | { mode: "move-tasks"; fromCategory: Category; fromSub: SubProject };

export function CategorySidebar({
  catStats,
  selectedId,
  onSelect,
  totalRisks,
  allRisks,
  canManageTree = false,
  onRequestEditor,
}: {
  catStats: CatStat[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  totalActive: number;
  totalRisks: number;
  allRisks: Risk[];
  canManageTree?: boolean;
  onRequestEditor?: (req: SystemTreeEditorRequest) => void;
}) {
  const productionWorkspace = isProductionWorkspace();
  const { user } = useAuth();
  const canDirectProject = usePermission(PERMISSIONS.RD_PROJECT_DIRECT);
  const canReviewProjectL1 = usePermission(PERMISSIONS.RD_PROJECT_REVIEW_L1);
  const canReviewProjectL2 = usePermission(PERMISSIONS.RD_PROJECT_REVIEW_L2);
  const canManagePeople = usePermission(PERMISSIONS.RD_PEOPLE_MANAGE);
  const canReassignTasks = usePermission(PERMISSIONS.RD_TASK_REASSIGN);
  // 全局移动会影响任意任务结构，只对专职移动/转派角色开放；普通编辑权限仍由工作台按本人任务处理。
  const canMoveTasks = useAnyPermission(PERMISSIONS.RD_TASK_MOVE, PERMISSIONS.RD_TASK_REASSIGN);
  const shouldReduceMotion = useReducedMotion();
  const selectedParentCatId = useMemo(() => {
    const id = selectedId;
    if (!id) return null;
    return catStats.find(({ cat }) => cat.id === id || cat.children.some((sub) => sub.id === id))?.cat.id ?? null;
  }, [catStats, selectedId]);
  const [expandedId, setExpandedId] = useState<string | null>(() => selectedParentCatId);

  useEffect(() => {
    setExpandedId(selectedParentCatId);
  }, [selectedParentCatId]);

  const toggleExpanded = (id: string) => {
    setExpandedId((current) => (current === id ? null : id));
  };

  return (
    <motion.aside
      initial={shouldReduceMotion ? false : { opacity: 0, x: -8 }}
      animate={{ opacity: 1, x: 0 }}
      transition={RD_PANEL_TRANSITION}
      className="rd-board-sidebar flex w-[292px] shrink-0 flex-col border-r border-slate-200/70 bg-[#edf3f8] shadow-[8px_0_24px_rgba(15,23,42,0.025)]"
    >
      <div className="rd-board-sidebar-head border-b border-slate-200/70 px-4 py-3">
        <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500">Navigation</div>
        <div className="mt-1 flex items-center justify-between gap-3">
          <h2 className="text-balance text-sm font-semibold text-slate-950">
            {productionWorkspace ? t("生产系统树") : t("研发系统树")}
          </h2>
          <div className="flex items-center gap-2">
            {totalRisks > 0 && (
              <span className="rounded-full bg-red-50 px-2 py-0.5 text-xs font-semibold text-red-700">{t("{count} 个风险", { count: totalRisks })}</span>
            )}
            {canManageTree && onRequestEditor && (
              <Button variant="unstyled"
                type="button"
                onClick={() => onRequestEditor({ mode: "add-system" })}
                className="rd-board-brand-control inline-flex h-7 items-center gap-1 rounded-md border border-primary/25 bg-accent px-2 text-xs font-semibold text-primary transition-colors hover:bg-accent"
                title={t("新增一级系统")}
              >
                <Plus className="h-3 w-3" />
                {t("新增")}
              </Button>
            )}
          </div>
        </div>
      </div>

      <nav className="rd-board-tree flex flex-1 flex-col gap-1.5 overflow-y-auto px-3 py-3">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="unstyled"
              type="button"
              onClick={() => {
                setExpandedId(null);
                onSelect(null);
              }}
              data-active={selectedId === null}
              className={cn(
                "rd-board-tree-root",
                "flex h-10 w-full cursor-pointer items-center gap-2 rounded-[8px] px-2.5 text-left transition-colors motion-reduce:transition-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/25 active:scale-[0.99]",
                selectedId === null ? "bg-white text-primary shadow-[0_8px_20px_rgba(79,70,229,0.08)] ring-1 ring-primary/25" : "text-slate-600 hover:bg-white/80 hover:text-slate-900 hover:shadow-[0_8px_18px_rgba(15,23,42,0.04)]",
              )}
              aria-label={t("全部系统")}
            >
              <LayoutGrid className="h-4 w-4 shrink-0" />
              <span className="min-w-0 flex-1 truncate text-sm font-semibold">{t("全部系统")}</span>
              {totalRisks > 0 && (
                <span className="flex min-w-5 items-center justify-center rounded-full bg-red-600 px-1.5 text-[10px] font-bold leading-5 text-white">
                  {totalRisks}
                </span>
              )}
            </Button>
          </TooltipTrigger>
          <TooltipContent side="right" align="start">
            <RiskListTooltip title={t("全部系统 · {count} 个风险任务", { count: totalRisks })} risks={allRisks} />
          </TooltipContent>
        </Tooltip>

        {catStats.map(({ cat, risks, riskItems }) => {
          const theme = getTheme(cat.id);
          const active = selectedId === cat.id;
          const activeWithin = active || cat.children.some((sub) => sub.id === selectedId);
          const expanded = expandedId === cat.id;

          const isReserved = isReservedBomSystem(cat.id);
          const subTaskCount = cat.children.reduce((sum, sub) => sum + collectTaskIds(sub.tasks).size, 0);
          return (
            <motion.div
              key={cat.id}
              layout
              transition={RD_LIST_TRANSITION}
              data-active={activeWithin}
              className={cn(
                "rd-board-tree-group",
                "group/cat rounded-[8px] transition-colors motion-reduce:transition-none",
                activeWithin ? "bg-white shadow-[0_10px_24px_rgba(15,23,42,0.06)] ring-1 ring-slate-200/80" : "hover:bg-white/65 hover:shadow-[0_8px_18px_rgba(15,23,42,0.035)]",
              )}
            >
              <div className="flex items-center gap-1 px-1 py-1">
                <Button variant="unstyled"
                  type="button"
                  onClick={() => toggleExpanded(cat.id)}
                  className="flex h-8 w-7 shrink-0 cursor-pointer items-center justify-center rounded-md text-muted-foreground transition-colors motion-reduce:transition-none duration-200 hover:bg-slate-100 hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-300 active:scale-95"
                  aria-label={expanded ? t("收起 {name}", { name: cat.label }) : t("展开 {name}", { name: cat.label })}
                  aria-expanded={expanded}
                >
                  <ChevronRight
                    className={cn(
                      "h-3.5 w-3.5 transition-transform duration-200 ease-out",
                      expanded && "rotate-90",
                    )}
                  />
                </Button>

                <Button variant="unstyled"
                  type="button"
                  onClick={() => {
                    setExpandedId(cat.id);
                    onSelect(cat.id);
                  }}
                  className="rd-board-tree-node flex h-8 min-w-0 flex-1 cursor-pointer items-center gap-2 rounded-md px-1.5 text-left transition-colors motion-reduce:transition-none duration-200 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-300 active:scale-[0.99]"
                >
                  <span
                    className={cn(
                      "rd-board-tree-indicator h-5 w-1 shrink-0 rounded-full bg-indigo-600 transition-colors motion-reduce:transition-none duration-200 ease-out",
                      activeWithin ? "scale-y-100 opacity-100" : "scale-y-0 opacity-0",
                    )}
                  />
                  <theme.Icon className={cn("h-4 w-4 shrink-0 transition-colors", theme.iconColor)} />
                  <span className="min-w-0 flex-1 truncate text-sm font-semibold text-slate-800">{cat.label}</span>
                </Button>

                {canManageTree && onRequestEditor && (
                  <div className="mr-1 flex items-center gap-0.5 opacity-0 transition-opacity duration-150 group-hover/cat:opacity-100 focus-within:opacity-100">
                    <Button variant="unstyled"
                      type="button"
                      onClick={(e) => { e.stopPropagation(); onRequestEditor({ mode: "add-sub", category: cat }); }}
                      className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-primary-hover"
                      title={t("新增子项")}
                      aria-label={t("为 {name} 新增子项", { name: cat.label })}
                    >
                      <FolderPlus className="h-3.5 w-3.5" />
                    </Button>
                    <Button variant="unstyled"
                      type="button"
                      onClick={(e) => { e.stopPropagation(); onRequestEditor({ mode: "edit-system", category: cat }); }}
                      className="rounded p-1 text-muted-foreground hover:bg-slate-100 hover:text-slate-700"
                      title={t("重命名")}
                      aria-label={t("重命名 {name}", { name: cat.label })}
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    {!isReserved && (
                      <Button variant="unstyled"
                        type="button"
                        aria-disabled={subTaskCount > 0}
                        aria-label={subTaskCount > 0 ? t("不能删除：含 {count} 个任务，请先移空", { count: subTaskCount }) : t("删除 {name}", { name: cat.label })}
                        onClick={(e) => { e.stopPropagation(); if (subTaskCount === 0) onRequestEditor({ mode: "delete-system", category: cat }); }}
                        className={cn(
                          "rounded p-1 transition-colors",
                          subTaskCount > 0
                            ? "cursor-not-allowed text-muted-foreground"
                            : "text-muted-foreground hover:bg-red-50 hover:text-red-600",
                        )}
                        title={subTaskCount > 0 ? t("含 {count} 个任务，请先移空后再删除", { count: subTaskCount }) : t("删除")}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    )}
                  </div>
                )}

                {risks > 0 && (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span className="mr-1 flex min-w-5 shrink-0 items-center justify-center rounded-full bg-red-600 px-1.5 text-[10px] font-bold leading-5 text-white transition-transform duration-150 hover:scale-110">
                        {risks}
                      </span>
                    </TooltipTrigger>
                    <TooltipContent side="right" align="start">
                      <RiskListTooltip title={t("{name} · {count} 个风险任务", { name: cat.label, count: risks })} risks={riskItems} />
                    </TooltipContent>
                  </Tooltip>
                )}
              </div>

              {/* Animated expand using CSS grid-rows trick */}
              <div
                className={cn(
                  "grid transition-[grid-template-rows] duration-200 ease-out",
                  expanded ? "grid-rows-[1fr]" : "grid-rows-[0fr]",
                )}
              >
                <div className="overflow-hidden">
                  <div
                    className={cn(
                      "ml-[34px] mr-2 space-y-1 border-l border-slate-300/70 pl-3 transition-colors motion-reduce:transition-none duration-200 ease-out",
                      expanded ? "translate-y-0 pb-2 pt-1 opacity-100" : "-translate-y-1 py-0 opacity-0",
                    )}
                  >
                    {cat.children.filter((sub) => !isDefaultSubProject(sub)).map((sub) => {
                      // 自动补出的默认子项不进导航树：它不是用户建的层级，
                      // 露出来会让人以为自己多建了一层，而且删掉下次读取还会补回来。
                      const subIds = collectTaskIds(sub.tasks);
                      const subRisks = riskItems.filter((risk) => subIds.has(risk.task.task_id));
                      const selected = selectedId === sub.id;
                      const subTaskTotal = collectTaskIds(sub.tasks).size;

                      return (
                        <div
                          key={sub.id}
                          data-active={selected}
                          className={cn(
                            "rd-board-tree-sub",
                            "group/sub flex h-8 w-full items-center gap-1 rounded-md pr-1 transition-colors motion-reduce:transition-none duration-200",
                            selected
                              ? "bg-indigo-50 shadow-[0_6px_14px_rgba(79,70,229,0.08)]"
                              : "hover:bg-slate-50",
                          )}
                        >
                          <Button variant="unstyled"
                            type="button"
                            onClick={() => {
                              setExpandedId(cat.id);
                              onSelect(sub.id);
                            }}
                            className={cn(
                              "flex min-w-0 flex-1 cursor-pointer items-center gap-2 rounded-md px-2 text-left transition-colors motion-reduce:transition-none duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-300 active:scale-[0.99]",
                              selected ? "text-primary" : "text-slate-600 hover:translate-x-0.5 hover:text-slate-900",
                            )}
                          >
                            <span
                              className={cn(
                                "h-1.5 w-1.5 shrink-0 rounded-full transition-colors duration-200",
                                subRisks.length > 0 ? "bg-red-500" : "bg-slate-300",
                              )}
                            />
                            <span className="min-w-0 flex-1 truncate text-xs font-semibold">{sub.label}</span>
                          </Button>
                          {(canManageTree || (canMoveTasks && subTaskTotal > 0)) && onRequestEditor && (
                            <div className="flex items-center gap-0.5 opacity-0 transition-opacity duration-150 group-hover/sub:opacity-100 focus-within:opacity-100">
                              {canManageTree && (
                                <Button variant="unstyled"
                                  type="button"
                                  onClick={(e) => { e.stopPropagation(); onRequestEditor({ mode: "edit-sub", category: cat, sub }); }}
                                  className="rounded p-1 text-muted-foreground transition-colors hover:bg-slate-100 hover:text-slate-700"
                                  title={t("重命名")}
                                  aria-label={t("重命名 {name}", { name: sub.label })}
                                >
                                  <Pencil className="h-3 w-3" />
                                </Button>
                              )}
                              {canMoveTasks && subTaskTotal > 0 && (
                                <Button variant="unstyled"
                                  type="button"
                                  onClick={(e) => { e.stopPropagation(); onRequestEditor({ mode: "move-tasks", fromCategory: cat, fromSub: sub }); }}
                                  className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-primary-hover"
                                  title={t("移动任务")}
                                  aria-label={t("移动 {name} 中的任务", { name: sub.label })}
                                >
                                  <ArrowRight className="h-3 w-3" />
                                </Button>
                              )}
                              {canManageTree && (
                                <Button variant="unstyled"
                                  type="button"
                                  aria-disabled={subTaskTotal > 0}
                                  aria-label={subTaskTotal > 0 ? t("不能删除：含 {count} 个任务，请先移空", { count: subTaskTotal }) : t("删除 {name}", { name: sub.label })}
                                  onClick={(e) => { e.stopPropagation(); if (subTaskTotal === 0) onRequestEditor({ mode: "delete-sub", category: cat, sub }); }}
                                  className={cn(
                                    "rounded p-1 transition-colors",
                                    subTaskTotal > 0
                                      ? "cursor-not-allowed text-muted-foreground"
                                      : "text-muted-foreground hover:bg-red-50 hover:text-red-600",
                                  )}
                                  title={subTaskTotal > 0 ? t("含 {count} 个任务，请先移空后再删除", { count: subTaskTotal }) : t("删除")}
                                >
                                  <Trash2 className="h-3 w-3" />
                                </Button>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            </motion.div>
          );
        })}
      </nav>
    </motion.aside>
  );
}

export function SystemTreeEditorDialog({
  request,
  onClose,
  onSubmit,
}: {
  request: SystemTreeEditorRequest;
  onClose: () => void;
  onSubmit: (label: string) => Promise<void> | void;
}) {
  const productionWorkspace = isProductionWorkspace();
  const shouldReduceMotion = useReducedMotion();
  const initialLabel =
    request.mode === "edit-system" ? request.category.label
    : request.mode === "edit-sub" ? request.sub.label
    : "";
  const [label, setLabel] = useState(initialLabel);
  const [saving, setSaving] = useState(false);

  const isDelete = request.mode === "delete-system" || request.mode === "delete-sub";
  const isEdit = request.mode === "edit-system" || request.mode === "edit-sub";
  const isAdd = request.mode === "add-system" || request.mode === "add-sub";

  const title =
    request.mode === "add-system" ? t("新增一级系统")
    : request.mode === "edit-system" ? t("重命名一级系统")
    : request.mode === "delete-system" ? t("删除一级系统")
    : request.mode === "add-sub" ? t("在「{name}」下新增子项", { name: request.category.label })
    : request.mode === "edit-sub" ? t("重命名子项")
    : t("删除子项");

  const taskCount =
    request.mode === "delete-system"
      ? request.category.children.reduce((s, ch) => s + ch.tasks.length, 0)
      : request.mode === "delete-sub"
      ? request.sub.tasks.length
      : 0;

  const handleConfirm = async () => {
    if (isDelete) {
      setSaving(true);
      try {
        await onSubmit("");
      } finally {
        setSaving(false);
      }
      return;
    }
    const trimmed = label.trim();
    if (!trimmed) {
      toast.error(t("名称不能为空"));
      return;
    }
    setSaving(true);
    try {
      await onSubmit(trimmed);
    } finally {
      setSaving(false);
    }
  };

  return (
    <motion.div
      initial={shouldReduceMotion ? false : { opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={RD_FAST_TRANSITION}
      className="rd-task-overlay fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm"
      onClick={(e) => { if (e.target === e.currentTarget && !saving) onClose(); }}
    >
      <motion.div
        initial={shouldReduceMotion ? false : { opacity: 0, y: 14, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={RD_PANEL_TRANSITION}
        className="rd-task-overlay-surface w-full max-w-md rounded-2xl bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className={cn(
          "flex items-center justify-between gap-3 border-b px-6 py-4",
          isDelete ? "border-red-100 bg-red-50/60" : "border-slate-100",
        )}>
          <div className="flex items-center gap-2.5">
            <div className={cn(
              "flex h-9 w-9 shrink-0 items-center justify-center rounded-full",
              isDelete ? "bg-red-100 text-red-600" : "bg-indigo-100 text-indigo-600",
            )}>
              {isDelete ? <Trash2 className="h-4 w-4" /> : isEdit ? <Pencil className="h-4 w-4" /> : <FolderPlus className="h-4 w-4" />}
            </div>
            <h3 className="text-base font-semibold text-slate-900">{title}</h3>
          </div>
          <Button variant="unstyled"
            type="button"
            disabled={saving}
            onClick={onClose}
            className="rounded-md p-1.5 text-muted-foreground hover:bg-slate-100 hover:text-slate-700 disabled:opacity-40"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>

        <div className="space-y-4 px-6 py-5">
          {isDelete ? (
            <>
              <p className="text-sm text-slate-700">
                {t("确认删除「{name}」？", { name: request.mode === "delete-system" ? request.category.label : (request as { sub: SubProject }).sub.label })}
              </p>
              {taskCount > 0 && (
                <div className="flex items-start gap-2 rounded-lg border border-amber-100 bg-amber-50/70 px-3 py-2.5 text-xs text-amber-700">
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  <span>{t("该节点下还有 {count} 个任务，删除后会一并清除，操作不可恢复。", { count: taskCount })}</span>
                </div>
              )}
              {taskCount === 0 && (
                <p className="text-xs text-slate-500">{t("该节点下没有任务，删除安全。")}</p>
              )}
            </>
          ) : (
            <div>
              <label className="mb-1.5 block text-xs font-medium text-slate-700">{t("名称")}</label>
              <Input
                autoFocus
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") handleConfirm(); }}
                placeholder={isAdd ? (request.mode === "add-system" ? t("例：新型动力系统") : t("例：主控板")) : t("新名称")}
                disabled={saving}
                className="w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm outline-none transition-colors motion-reduce:transition-none focus:border-primary/25 focus:ring-2 focus:ring-primary/25 disabled:bg-slate-50"
              />
              {request.mode === "add-system" && (
                <p className="mt-1.5 text-pretty text-[11px] text-muted-foreground">
                  {productionWorkspace
                    ? t("将作为生产系统树的一级节点；可在保存后添加子项。")
                    : t("将作为研发系统树的一级节点；可在保存后添加子项。")}
                </p>
              )}
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 border-t border-slate-100 px-6 py-3">
          <Button variant="unstyled"
            type="button"
            disabled={saving}
            onClick={onClose}
            className="rounded-md border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-40"
          >
            {t("取消")}
          </Button>
          <Button variant="unstyled"
            type="button"
            disabled={saving}
            onClick={handleConfirm}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold text-white shadow-sm transition-colors disabled:opacity-60",
              isDelete ? "bg-red-600 hover:bg-red-700" : "bg-primary hover:bg-primary-hover",
            )}
          >
            {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            {isDelete ? t("确认删除") : isEdit ? t("保存") : t("新增")}
          </Button>
        </div>
      </motion.div>
    </motion.div>
  );
}
