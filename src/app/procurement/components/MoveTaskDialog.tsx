// 移动任务归类：把任务显式挂到子系统树的任意节点，或解除归属退回按物料自动推导。
import { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronRight, FolderTree, Loader2, Sparkles } from "lucide-react";
import { toast } from "sonner";

import { useI18n } from "../../lib/i18n";
import { listProcTaskTree, moveProcTasks, type ProcTaskTreeNode } from "../../lib/procurementApi";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../../components/ui/dialog";
import { cn } from "../../components/ui/utils";

/** 自动归类的哨兵值：Radix 不允许空字符串作为选中值，用它表示「解除显式归属」。 */
const AUTO_NODE = "__auto__";

export function MoveTaskDialog({
  taskIds,
  productId,
  currentNodeId,
  onClose,
  onMoved,
}: {
  taskIds: string[];
  productId: string;
  /** 任务当前所在节点，用于高亮与禁用「移到原位」 */
  currentNodeId?: string | null;
  onClose: () => void;
  onMoved: () => void;
}) {
  const { t } = useI18n();
  const [roots, setRoots] = useState<ProcTaskTreeNode[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState<string>(currentNodeId ?? AUTO_NODE);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
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
  }, [productId, currentNodeId, t]);

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

  const unchanged = selected === (currentNodeId ?? AUTO_NODE);

  const handleConfirm = async () => {
    setSaving(true);
    try {
      const result = await moveProcTasks(taskIds, selected === AUTO_NODE ? undefined : selected);
      toast.success(t("已移动 {count} 个任务到「{target}」", { count: result.moved, target: result.targetLabel }));
      onMoved();
      onClose();
    } catch (caught) {
      toast.error(caught instanceof Error ? caught.message : t("移动失败"));
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
            role="button"
            tabIndex={0}
            onClick={() => setSelected(node.id)}
            onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); setSelected(node.id); } }}
            style={{ paddingLeft: `${depth * 16 + 8}px` }}
            className={cn(
              "flex cursor-pointer items-center gap-1.5 rounded-lg py-1.5 pr-2 text-sm transition",
              isSelected ? "bg-indigo-50 font-semibold text-indigo-700" : "text-slate-700 hover:bg-slate-50",
            )}
          >
            {hasChildren ? (
              <button
                type="button"
                onClick={(event) => { event.stopPropagation(); toggle(node.id); }}
                className="shrink-0 rounded p-0.5 hover:bg-slate-200"
                aria-label={isOpen ? t("收起") : t("展开")}
              >
                <ChevronRight className={cn("h-3.5 w-3.5 text-slate-400 transition-transform", isOpen && "rotate-90")} />
              </button>
            ) : (
              <span className="w-4.5 shrink-0" />
            )}
            <span className="truncate">{node.name}</span>
            {node.taskCount > 0 ? (
              <span className="shrink-0 rounded-full bg-slate-100 px-1.5 text-[10px] text-slate-500">{node.taskCount}</span>
            ) : null}
            {node.id === currentNodeId ? (
              <span className="shrink-0 text-[10px] text-slate-400">{t("当前")}</span>
            ) : null}
          </div>
          {hasChildren && isOpen ? renderNodes(node.children, depth + 1) : null}
        </div>
      );
    });

  return (
    <Dialog open onOpenChange={(next) => { if (!next && !saving) onClose(); }}>
      <DialogContent className="border-slate-200 p-0 sm:max-w-lg">
        <DialogHeader className="border-b border-slate-100 bg-slate-50/80 px-6 py-5 pr-14">
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-indigo-600 text-white">
              <FolderTree className="h-4.5 w-4.5" />
            </span>
            <div>
              <DialogTitle>{t("移动归类")}</DialogTitle>
              <DialogDescription className="mt-1">
                {t("选择任务归属的子系统节点，可挂到任意层级；共 {count} 个任务", { count: taskIds.length })}
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="max-h-[52vh] overflow-y-auto px-4 py-3">
          {loading ? (
            <div className="flex items-center justify-center gap-2 py-10 text-sm text-slate-400">
              <Loader2 className="h-4 w-4 animate-spin" />{t("加载子系统树")}…
            </div>
          ) : error ? (
            <p className="py-10 text-center text-sm text-red-500">{error}</p>
          ) : (
            <>
              <div
                role="button"
                tabIndex={0}
                onClick={() => setSelected(AUTO_NODE)}
                onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); setSelected(AUTO_NODE); } }}
                className={cn(
                  "mb-2 flex cursor-pointer items-start gap-2 rounded-lg border px-3 py-2 text-sm transition",
                  selected === AUTO_NODE ? "border-indigo-300 bg-indigo-50" : "border-slate-200 hover:bg-slate-50",
                )}
              >
                <Sparkles className={cn("mt-0.5 h-4 w-4 shrink-0", selected === AUTO_NODE ? "text-indigo-600" : "text-slate-400")} />
                <span>
                  <span className={cn("block font-semibold", selected === AUTO_NODE ? "text-indigo-700" : "text-slate-700")}>
                    {t("自动归类")}
                  </span>
                  <span className="mt-0.5 block text-[11px] leading-relaxed text-slate-500">
                    {t("解除手工归属，按物料自动挂到对应节点；物料重名时可能挂不上")}
                  </span>
                </span>
              </div>
              {roots.length === 0 ? (
                <p className="py-8 text-center text-sm text-slate-400">{t("该产品还没有维护子系统树")}</p>
              ) : (
                renderNodes(roots)
              )}
            </>
          )}
        </div>

        <DialogFooter className="flex-row items-center justify-between gap-3 border-t border-slate-100 bg-slate-50/60 px-6 py-4">
          <p className="min-w-0 truncate text-xs text-slate-600">
            {t("目标")}：<span className="font-semibold text-slate-900">{selectedLabel || t("未选择")}</span>
          </p>
          <div className="flex shrink-0 items-center gap-2">
            <button type="button" onClick={onClose} disabled={saving} className="material-button-secondary px-4 py-2 text-xs disabled:opacity-50">
              {t("取消")}
            </button>
            <button
              type="button"
              onClick={() => void handleConfirm()}
              disabled={saving || loading || unchanged || !selectedLabel}
              className="material-button-primary px-4 py-2 text-xs disabled:opacity-50"
            >
              {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FolderTree className="h-3.5 w-3.5" />}
              {t("确认移动")}
            </button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
