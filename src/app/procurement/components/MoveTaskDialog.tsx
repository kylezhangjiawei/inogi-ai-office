// 移动任务归类：把任务显式挂到子系统树的任意节点，或解除归属退回按物料自动推导。
import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, ChevronRight, FolderTree, Loader2, Sparkles } from "lucide-react";
import { toast } from "sonner";

import { useI18n } from "../../lib/i18n";
import { listProcTaskTree, moveProcTasks, type ProcTaskTreeNode } from "../../lib/procurementApi";
import type { ProcurementTask } from "../data";
import { Checkbox } from "../../components/ui/checkbox";
import { Input } from "../../components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../../components/ui/dialog";
import { cn } from "../../components/ui/utils";
import { Button } from "../../components/ui/button";

/** 自动归类的哨兵值：Radix 不允许空字符串作为选中值，用它表示「解除显式归属」。 */
const AUTO_NODE = "__auto__";

export function MoveTaskDialog({
  taskIds,
  candidates,
  productId,
  currentNodeId,
  onClose,
  onMoved,
}: {
  /** 固定任务集（详情抽屉入口）。与 candidates 二选一 */
  taskIds?: string[];
  /** 候选任务集（驾驶舱批量入口）：弹窗内先勾选任务再选目标类目 */
  candidates?: ProcurementTask[];
  productId: string;
  /** 任务当前所在节点，用于高亮与禁用「移到原位」；仅固定任务集模式有意义 */
  currentNodeId?: string | null;
  onClose: () => void;
  onMoved: () => void;
}) {
  const { t } = useI18n();
  const batchMode = Array.isArray(candidates);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [keyword, setKeyword] = useState("");
  const [roots, setRoots] = useState<ProcTaskTreeNode[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState<string>(currentNodeId ?? AUTO_NODE);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);
  const [actionError, setActionError] = useState("");
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError("");
    listProcTaskTree(productId, controller.signal)
      .then((data) => {
        setRoots(data.roots);
        // 默认展开到当前节点，省得用户自己找
        const path = new Set<string>();
        const walk = (nodes: ProcTaskTreeNode[], trail: string[]): boolean => {
          for (const node of nodes) {
            const next = [...trail, node.id];
            if (node.id === currentNodeId) {
              trail.forEach((id) => path.add(id));
              return true;
            }
            if (walk(node.children ?? [], next)) {
              path.add(node.id);
              return true;
            }
          }
          return false;
        };
        walk(data.roots, []);
        setExpanded(new Set([...data.roots.map((node) => node.id), ...path]));
      })
      .catch((caught) => {
        if (!controller.signal.aborted) setError(caught instanceof Error ? caught.message : t("读取子系统树失败"));
      })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [productId, currentNodeId, reloadKey, t]);

  const toggle = useCallback((id: string) => {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const selectedLabel = useMemo(() => {
    if (selected === AUTO_NODE) return t("自动归类（按物料推导）");
    let found = "";
    const walk = (nodes: ProcTaskTreeNode[]) => {
      for (const node of nodes) {
        if (node.id === selected) { found = node.name; return; }
        walk(node.children ?? []);
      }
    };
    walk(roots);
    return found;
  }, [selected, roots, t]);

  // 批量模式下「原位」无意义（多个任务归属可能不同），只在固定任务集时禁用未改变的提交
  const unchanged = !batchMode && selected === (currentNodeId ?? AUTO_NODE);
  const effectiveIds = batchMode ? [...picked] : taskIds ?? [];

  const visibleCandidates = useMemo(() => {
    if (!candidates) return [];
    const kw = keyword.trim().toLowerCase();
    // 终态任务也可移动：归类是整理动作，不改业务状态
    return kw
      ? candidates.filter((task) => `${task.code} ${task.materialName} ${task.buyer}`.toLowerCase().includes(kw))
      : candidates;
  }, [candidates, keyword]);

  const allPicked = visibleCandidates.length > 0 && visibleCandidates.every((task) => picked.has(task.id));

  const handleConfirm = async () => {
    if (effectiveIds.length === 0) {
      const message = t("请至少勾选一个任务");
      setActionError(message);
      toast.error(message);
      return;
    }
    setActionError("");
    setSaving(true);
    try {
      const result = await moveProcTasks(effectiveIds, selected === AUTO_NODE ? undefined : selected);
      toast.success(t("已移动 {count} 个任务到「{target}」", { count: result.moved, target: result.targetLabel }));
      onMoved();
      onClose();
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : t("移动失败");
      setActionError(message);
      toast.error(message);
    } finally {
      setSaving(false);
    }
  };

  const renderNodes = (nodes: ProcTaskTreeNode[], depth = 0) =>
    nodes.map((node) => {
      const hasChildren = (node.children?.length ?? 0) > 0;
      const isOpen = expanded.has(node.id);
      const isSelected = selected === node.id;
      return (
        <div key={node.id}>
          <div
            style={{ paddingLeft: `${depth * 16 + 8}px` }}
            className={cn(
              "flex items-center gap-1.5 rounded-lg py-1.5 pr-2 text-sm",
              isSelected ? "bg-accent font-semibold text-primary" : "text-slate-700 hover:bg-slate-50",
            )}
          >
            {hasChildren ? (
              <Button variant="unstyled"
                type="button"
                onClick={(event) => { event.stopPropagation(); toggle(node.id); }}
                className="shrink-0 rounded p-0.5 hover:bg-slate-200"
                aria-label={isOpen ? t("收起") : t("展开")}
              >
                <ChevronRight className={cn("size-3.5 text-muted-foreground", isOpen && "rotate-90")} />
              </Button>
            ) : (
              <span className="w-4.5 shrink-0" />
            )}
            <Button variant="unstyled"
              type="button"
              aria-pressed={isSelected}
              onClick={() => { setSelected(node.id); setActionError(""); }}
              className="flex min-w-0 flex-1 items-center gap-1.5 rounded text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
            >
              <span className="min-w-0 flex-1 truncate">{node.name}</span>
              {node.taskCount > 0 ? (
                <span className="shrink-0 rounded-full bg-slate-100 px-1.5 text-[10px] tabular-nums text-slate-500">{node.taskCount}</span>
              ) : null}
              {node.id === currentNodeId ? (
                <span className="shrink-0 text-[10px] text-muted-foreground">{t("当前")}</span>
              ) : null}
            </Button>
          </div>
          {hasChildren && isOpen ? renderNodes(node.children, depth + 1) : null}
        </div>
      );
    });

  return (
    <Dialog open onOpenChange={(next) => { if (!next && !saving) onClose(); }}>
      <DialogContent className="proc-horizon-overlay border-slate-200 p-0 sm:max-w-lg">
        <DialogHeader className="border-b border-slate-100 bg-slate-50/80 px-6 py-5 pr-14">
          <div className="flex items-center gap-3">
            <span className="flex size-10 items-center justify-center rounded-2xl bg-primary text-white">
              <FolderTree className="h-4.5 w-4.5" />
            </span>
            <div>
              <DialogTitle className="text-balance">{t("移动归类")}</DialogTitle>
              <DialogDescription className="mt-1 text-pretty tabular-nums">
                {batchMode
                  ? t("勾选任务并选择归属的子系统节点，可挂到任意层级；已选 {count} 个", { count: picked.size })
                  : t("选择任务归属的子系统节点，可挂到任意层级；共 {count} 个任务", { count: effectiveIds.length })}
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="grid grid-cols-2 border-b border-slate-100 bg-white px-6 py-2.5">
          {[
            { label: batchMode ? t("选择待移动任务") : t("确认待移动任务"), complete: !batchMode || picked.size > 0 },
            { label: t("选择目标归属"), complete: Boolean(selectedLabel) },
          ].map((step, index) => {
            const active = index === (batchMode && picked.size === 0 ? 0 : 1);
            return <div key={step.label} className={cn("flex items-center gap-2 text-xs", active ? "font-semibold text-primary" : step.complete ? "text-emerald-700" : "text-muted-foreground")}><span className={cn("flex size-5 items-center justify-center rounded-full border text-[10px] font-semibold tabular-nums", active ? "border-primary bg-primary text-white" : step.complete ? "border-emerald-300 bg-emerald-50" : "border-slate-200")}>{step.complete && !active ? <CheckCircle2 className="size-3" /> : index + 1}</span><span className="truncate">{step.label}</span></div>;
          })}
        </div>

        {batchMode ? (
          <div className="border-b border-slate-100 px-4 py-3">
            <div className="mb-2 flex items-center gap-2">
              <Input
                value={keyword}
                onChange={(event) => setKeyword(event.target.value)}
                aria-label={t("搜索待移动任务")}
                placeholder={t("搜索单号 / 物料 / 负责人")}
                className="h-8 flex-1 text-xs"
              />
              <Button variant="unstyled"
                type="button"
                onClick={() => { setPicked(allPicked ? new Set() : new Set(visibleCandidates.map((task) => task.id))); setActionError(""); }}
                className="shrink-0 text-xs font-semibold text-primary hover:underline"
              >
                {allPicked ? t("全部取消") : t("全部选中")}
              </Button>
            </div>
            <div className="max-h-40 overflow-y-auto rounded-lg border border-slate-200">
              {visibleCandidates.length === 0 ? (
                <p className="py-6 text-center text-xs text-muted-foreground">{t("没有匹配的任务")}</p>
              ) : (
                visibleCandidates.map((task) => (
                  <label key={task.id} className="flex cursor-pointer items-center gap-2 border-b border-slate-100 px-3 py-1.5 text-xs last:border-b-0 hover:bg-slate-50">
                    <Checkbox
                      checked={picked.has(task.id)}
                      onCheckedChange={() => {
                        setActionError("");
                        setPicked((current) => {
                          const next = new Set(current);
                          if (next.has(task.id)) next.delete(task.id);
                          else next.add(task.id);
                          return next;
                        });
                      }}
                    />
                    <span className="shrink-0 font-mono text-slate-500">{task.code}</span>
                    <span className="min-w-0 flex-1 truncate text-slate-700">{task.materialName}</span>
                    <span className="shrink-0 text-muted-foreground">{task.buyer}</span>
                  </label>
                ))
              )}
            </div>
          </div>
        ) : null}

        <div className="max-h-[52vh] overflow-y-auto px-4 py-3">
          {loading ? (
            <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />{t("加载子系统树")}…
            </div>
          ) : error ? (
            <div role="alert" className="flex flex-col items-center gap-3 py-10 text-center"><AlertTriangle className="size-5 text-rose-600" /><p className="max-w-sm text-pretty text-sm text-rose-700">{error}</p><Button variant="unstyled" type="button" onClick={() => setReloadKey((value) => value + 1)} className="material-button-secondary px-3 py-2 text-xs">{t("重新加载归属树")}</Button></div>
          ) : (
            <>
              <Button variant="unstyled"
                type="button"
                aria-pressed={selected === AUTO_NODE}
                onClick={() => { setSelected(AUTO_NODE); setActionError(""); }}
                className={cn(
                  "mb-2 flex w-full cursor-pointer items-start gap-2 rounded-lg border px-3 py-2 text-left text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40",
                  selected === AUTO_NODE ? "border-primary/40 bg-accent" : "border-slate-200 hover:bg-slate-50",
                )}
              >
                <Sparkles className={cn("mt-0.5 size-4 shrink-0", selected === AUTO_NODE ? "text-primary" : "text-muted-foreground")} />
                <span>
                  <span className={cn("block font-semibold", selected === AUTO_NODE ? "text-primary" : "text-slate-700")}>
                    {t("自动归类")}
                  </span>
                  <span className="mt-0.5 block text-pretty text-[11px] leading-relaxed text-slate-500">
                    {t("解除手工归属，按物料自动挂到对应节点；物料重名时可能挂不上")}
                  </span>
                </span>
              </Button>
              {roots.length === 0 ? (
                <p className="py-8 text-center text-pretty text-sm text-muted-foreground">{t("该产品还没有维护子系统树，可先保留自动归类。")}</p>
              ) : (
                renderNodes(roots)
              )}
            </>
          )}
          {actionError && <div role="alert" className="mt-3 flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-pretty text-xs text-rose-700"><AlertTriangle className="mt-0.5 size-3.5 shrink-0" />{actionError}</div>}
        </div>

        <DialogFooter className="flex-row items-center justify-between gap-3 border-t border-slate-100 bg-slate-50/60 px-6 py-4">
          <p className="min-w-0 truncate text-xs text-slate-600">
            {t("目标")}：<span className="font-semibold text-slate-900">{selectedLabel || t("未选择")}</span>
          </p>
          <div className="flex shrink-0 items-center gap-2">
            <Button variant="unstyled" type="button" onClick={onClose} disabled={saving} className="material-button-secondary px-4 py-2 text-xs disabled:opacity-50">
              {t("取消")}
            </Button>
            <Button variant="unstyled"
              type="button"
              onClick={() => void handleConfirm()}
              disabled={saving || loading || unchanged || !selectedLabel || effectiveIds.length === 0}
              className="material-button-primary px-4 py-2 text-xs disabled:opacity-50"
            >
              {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FolderTree className="h-3.5 w-3.5" />}
              {saving ? t("正在移动…") : t("移动 {count} 个任务", { count: effectiveIds.length })}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
