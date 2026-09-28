import { useEffect, useState, useMemo } from "react";
import { ArrowRight, Loader2, X } from "lucide-react";
import { toast } from "sonner";
import { NativeSelect } from "../components/ui/native-select";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "../components/ui/dialog";
import { fetchProductTaskCategories } from "../lib/rdApi";
import { t } from "../lib/i18n";
import { Button } from "../components/ui/button";
import { type Category, type ProductDef, MAIN_PRODUCT_ID, type Task, taskVisibleTitle, type SubProject } from './taskModel';

// ─── 移动目标产品树（产品→系统→子项）─────────────────────────────────────────
// 任务源始终是主产品(驾驶舱展示的便携式制氧机)；目标可切换到任意产品。
// 主产品树用传入的 categories；其他产品按需经 fetchProductTaskCategories 懒加载并缓存。
export function useMoveTargetTree(mainCategories: Category[], _products: ProductDef[]) {
  const [targetProductId, setTargetProductId] = useState<string>(MAIN_PRODUCT_ID);
  const [treeCache, setTreeCache] = useState<Record<string, Category[]>>({});
  const [loadingTree, setLoadingTree] = useState(false);

  useEffect(() => {
    if (targetProductId === MAIN_PRODUCT_ID) return;
    if (treeCache[targetProductId]) return;
    let cancelled = false;
    setLoadingTree(true);
    fetchProductTaskCategories(targetProductId)
      .then((cats) => {
        if (!cancelled) setTreeCache((prev) => ({ ...prev, [targetProductId]: cats }));
      })
      .catch(() => {
        if (!cancelled) {
          setTreeCache((prev) => ({ ...prev, [targetProductId]: [] }));
          toast.error(t("目标产品分类加载失败，请重试"));
        }
      })
      .finally(() => {
        if (!cancelled) setLoadingTree(false);
      });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetProductId]);

  const targetCategories =
    targetProductId === MAIN_PRODUCT_ID ? mainCategories : (treeCache[targetProductId] ?? []);

  return { targetProductId, setTargetProductId, targetCategories, loadingTree };
}

// ─── MoveTaskDialog (single task) ────────────────────────────────────────────
export function MoveTaskDialog({
  task,
  categories,
  products,
  onConfirm,
  onClose,
}: {
  task: Task;
  categories: Category[];
  products: ProductDef[];
  onConfirm: (targetProductId: string, targetCatId: string, targetSubId: string) => Promise<void>;
  onClose: () => void;
}) {
  const visibleTaskTitle = taskVisibleTitle(task);
  const [targetCatId, setTargetCatId] = useState<string>("");
  const [targetSubId, setTargetSubId] = useState<string>("");
  const [saving, setSaving] = useState(false);
  const { targetProductId, setTargetProductId, targetCategories, loadingTree } =
    useMoveTargetTree(categories, products);
  const isCrossProduct = targetProductId !== MAIN_PRODUCT_ID;
  // Find which sub the task currently lives in (源始终是主产品)
  const currentSubId = useMemo(() => {
    for (const cat of categories) {
      for (const sub of cat.children) {
        if (sub.tasks.some((t) => t.task_id === task.task_id)) return sub.id;
      }
    }
    return null;
  }, [categories, task.task_id]);

  const allTargetOptions = useMemo(() => {
    const opts: { cat: Category; sub: SubProject }[] = [];
    for (const cat of targetCategories) {
      for (const sub of cat.children) {
        // 仅在「目标=主产品(同源)」时排除任务当前所在子项；跨产品时全部可选
        if (!isCrossProduct && sub.id === currentSubId) continue;
        opts.push({ cat, sub });
      }
    }
    return opts;
  }, [targetCategories, isCrossProduct, currentSubId]);

  // 切换产品时清空系统/子项；切换系统时清空子项
  useEffect(() => { setTargetCatId(""); setTargetSubId(""); }, [targetProductId]);
  useEffect(() => { setTargetSubId(""); }, [targetCatId]);

  const targetSubOptions = useMemo(
    () => targetCatId ? allTargetOptions.filter((o) => o.cat.id === targetCatId) : allTargetOptions,
    [allTargetOptions, targetCatId],
  );

  const handleConfirm = async () => {
    if (!targetSubId) { toast.error(t("请选择目标子项")); return; }
    const chosen = allTargetOptions.find((o) => o.sub.id === targetSubId);
    if (!chosen) { toast.error(t("目标子项无效，请重新选择")); return; }
    setSaving(true);
    try {
      await onConfirm(targetProductId, chosen.cat.id, targetSubId);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !saving) onClose();
      }}
    >
      <DialogContent
        className="rd-task-overlay-surface z-[60] gap-0 overflow-hidden border-0 bg-white p-0 shadow-2xl sm:max-w-md [&>button:last-child]:hidden"
        onEscapeKeyDown={(event) => { if (saving) event.preventDefault(); }}
        onPointerDownOutside={(event) => { if (saving) event.preventDefault(); }}
        onInteractOutside={(event) => { if (saving) event.preventDefault(); }}
      >
        <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-indigo-100 text-indigo-600">
              <ArrowRight className="h-4 w-4" />
            </div>
            <div>
              <DialogTitle className="text-base font-semibold text-slate-900">{t("移动任务")}</DialogTitle>
              <DialogDescription className="max-w-[260px] truncate text-xs text-slate-500">
                {visibleTaskTitle}
              </DialogDescription>
            </div>
          </div>
          <Button variant="unstyled"
            type="button"
            aria-label={t("关闭移动任务")}
            disabled={saving}
            onClick={() => { if (!saving) onClose(); }}
            className="rounded-lg p-1.5 hover:bg-slate-100 disabled:pointer-events-none disabled:opacity-40"
          >
            <X className="h-4 w-4 text-slate-500" />
          </Button>
        </div>

        <div className="space-y-4 p-6">
          <div className="rounded-lg border border-slate-100 bg-slate-50 px-3 py-2 text-xs text-slate-500">
            {t("当前位置：")}<span className="font-medium text-slate-700">{task.category_path || t("未分类")}</span>
          </div>

          <div>
            <label className="mb-2 block text-sm font-medium text-slate-700">{t("目标位置")}</label>
            <div className="mb-2">
              <label htmlFor="move-task-product" className="mb-1 block text-xs text-slate-500">{t("产品")}</label>
              <NativeSelect
                id="move-task-product"
                value={targetProductId}
                onChange={(e) => setTargetProductId(e.target.value)}
                className="w-full text-sm"
              >
                {products.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}{p.id === MAIN_PRODUCT_ID ? t("（当前）") : ""}</option>
                ))}
              </NativeSelect>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label htmlFor="move-task-category" className="mb-1 block text-xs text-slate-500">{t("一级系统")}</label>
                <NativeSelect
                  id="move-task-category"
                  value={targetCatId}
                  onChange={(e) => setTargetCatId(e.target.value)}
                  className="w-full text-sm"
                  disabled={loadingTree}
                >
                  <option value="">{t("全部系统")}</option>
                  {targetCategories.map((cat) => (
                    <option key={cat.id} value={cat.id}>{cat.label}</option>
                  ))}
                </NativeSelect>
              </div>
              <div>
                <label htmlFor="move-task-subproject" className="mb-1 block text-xs text-slate-500">{t("子项")}</label>
                <NativeSelect
                  id="move-task-subproject"
                  value={targetSubId}
                  onChange={(e) => setTargetSubId(e.target.value)}
                  className="w-full text-sm"
                  disabled={loadingTree}
                >
                  <option value="">{loadingTree ? t("加载中…") : t("请选择子项")}</option>
                  {targetSubOptions.map(({ cat, sub }) => (
                    <option key={sub.id} value={sub.id}>{cat.label} / {sub.label}</option>
                  ))}
                </NativeSelect>
              </div>
            </div>
            {isCrossProduct && (
              <p className="mt-2 text-xs text-amber-600">
                {t("跨产品移动：任务将从当前产品移出，归入所选产品。")}
              </p>
            )}
          </div>
        </div>

        <div className="flex justify-end gap-2 border-t border-slate-100 px-6 py-3">
          <Button variant="unstyled"
            type="button"
            disabled={saving}
            onClick={() => { if (!saving) onClose(); }}
            className="rounded-md border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-40"
          >
            {t("取消")}
          </Button>
          <Button
            type="button"
            disabled={saving || loadingTree || !targetSubId}
            onClick={handleConfirm}
            className="inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold shadow-sm transition-colors disabled:opacity-60"
          >
            {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : <ArrowRight className="h-3 w-3" />}
            {t("确认移动")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
