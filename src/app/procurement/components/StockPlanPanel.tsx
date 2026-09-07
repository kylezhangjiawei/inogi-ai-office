import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  CalendarClock,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  CircleDashed,
  PackagePlus,
  Pencil,
  Plus,
  Search,
  Trash2,
  Truck,
  X,
} from "lucide-react";
import { toast } from "sonner";

import { useI18n } from "../../lib/i18n";
import {
  createProcStockPlan,
  createProcStockPlanBatch,
  deleteProcStockPlanBatch,
  listProcStockPlans,
  updateProcStockPlan,
  updateProcStockPlanBatch,
  type Material,
  type ProcStockPlan,
  type ProcStockPlanBatch,
  type ProcStockPlanBatchInput,
  type ProcStockPlanInput,
  type ProcStockPlanStatus,
} from "../../lib/procurementApi";
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
import { Button } from "../../components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../../components/ui/dialog";
import { Input } from "../../components/ui/input";
import { Textarea } from "../../components/ui/textarea";
import { cn } from "../../components/ui/utils";

type StatusFilter = "all" | ProcStockPlanStatus;

const STATUS_LABELS: Record<ProcStockPlanStatus, string> = {
  not_started: "未开始",
  in_progress: "采购中",
  completed: "已完成",
};

function quantity(value: number) {
  return new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 3 }).format(value);
}

function PlanStatus({ status }: { status: ProcStockPlanStatus }) {
  const { t } = useI18n();
  const Icon = status === "completed" ? CheckCircle2 : status === "in_progress" ? Truck : CircleDashed;
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-xs font-semibold",
        status === "completed" && "bg-emerald-50 text-emerald-700",
        status === "in_progress" && "bg-accent text-primary",
        status === "not_started" && "bg-slate-100 text-slate-600",
      )}
    >
      <Icon aria-hidden="true" className="size-3.5" />
      {t(STATUS_LABELS[status])}
    </span>
  );
}

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <label className="grid min-w-0 gap-1.5 text-xs font-semibold text-slate-600">
      <span>{label}{required ? <span className="ml-0.5 text-rose-600">*</span> : null}</span>
      {children}
    </label>
  );
}

function StockPlanFormDialog({
  plan,
  materials,
  onClose,
  onSaved,
}: {
  plan?: ProcStockPlan;
  materials: Material[];
  onClose: () => void;
  onSaved: (plan: ProcStockPlan) => void;
}) {
  const { t } = useI18n();
  const [form, setForm] = useState({
    materialId: plan?.materialId ?? "",
    materialName: plan?.materialName ?? "",
    spec: plan?.spec ?? "",
    unit: plan?.unit ?? "",
    targetQty: plan ? String(plan.targetQty) : "",
    targetDate: plan?.targetDate ?? "",
    note: plan?.note ?? "",
  });
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const openerRef = useRef(typeof document !== "undefined" && document.activeElement instanceof HTMLElement ? document.activeElement : null);

  const changeMaterial = (value: string) => {
    const matches = materials.filter((material) => material.name === value);
    const match = matches.length === 1 ? matches[0] : undefined;
    setForm((current) => ({
      ...current,
      materialName: value,
      materialId: match?.id ?? "",
      spec: match?.spec ?? current.spec,
      unit: match?.unit ?? current.unit,
    }));
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setSaveError(null);
    const targetQty = Number(form.targetQty);
    if (!form.materialName.trim()) {
      setSaveError(t("请填写物料名称"));
      return;
    }
    if (!Number.isFinite(targetQty) || targetQty <= 0) {
      setSaveError(t("目标采购量必须大于 0"));
      return;
    }
    const input: ProcStockPlanInput = {
      materialId: form.materialId || undefined,
      materialName: form.materialName.trim(),
      spec: form.spec.trim(),
      unit: form.unit.trim(),
      targetQty,
      targetDate: form.targetDate || undefined,
      note: form.note.trim() || undefined,
    };
    setSaving(true);
    try {
      const saved = plan
        ? await updateProcStockPlan(plan.id, input)
        : await createProcStockPlan(input);
      onSaved(saved);
      toast.success(t(plan ? "备货计划已更新" : "备货总计划已创建"));
      onClose();
    } catch (cause) {
      setSaveError(cause instanceof Error ? cause.message : t("保存失败"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => { if (!open && !saving) onClose(); }}>
      <DialogContent
        className="proc-horizon-overlay proc-stock-plan-form-dialog flex flex-col overflow-hidden p-0 sm:max-w-2xl"
        onCloseAutoFocus={(event) => {
          if (openerRef.current?.isConnected) { event.preventDefault(); openerRef.current.focus(); }
        }}
      >
        <form onSubmit={submit} className="flex min-h-0 flex-1 flex-col">
          <DialogHeader className="px-6 pb-4 pt-6 pr-14">
            <DialogTitle>{t(plan ? "编辑备货总计划" : "新建备货总计划")}</DialogTitle>
            <DialogDescription>{t("先设定总采购量，后续可按采购批次和供应商逐笔登记。")}</DialogDescription>
          </DialogHeader>

          <div className="proc-stock-plan-form-fields grid min-h-0 gap-4 overflow-y-auto overscroll-contain px-6 pb-6 sm:grid-cols-2">
            <Field label={t("物料名称")} required>
              <Input
                list="proc-stock-plan-material-options"
                value={form.materialName}
                onChange={(event) => changeMaterial(event.target.value)}
                placeholder={t("输入或选择物料")}
                required
                autoFocus
              />
              <datalist id="proc-stock-plan-material-options">
                {materials.map((material) => (
                  <option key={material.id} value={material.name}>{material.spec}</option>
                ))}
              </datalist>
            </Field>
            <Field label={t("规格型号")}>
              <Input value={form.spec} onChange={(event) => setForm((current) => ({ ...current, spec: event.target.value }))} placeholder={t("可选")} />
            </Field>
            <Field label={t("目标采购量")} required>
              <Input type="number" min="0.001" step="0.001" required value={form.targetQty} onChange={(event) => setForm((current) => ({ ...current, targetQty: event.target.value }))} placeholder="0" className="tabular-nums" />
            </Field>
            <Field label={t("单位")}>
              <Input value={form.unit} onChange={(event) => setForm((current) => ({ ...current, unit: event.target.value }))} placeholder={t("如：件、套、kg")} />
            </Field>
            <Field label={t("计划完成日期")}>
              <Input type="date" value={form.targetDate} onChange={(event) => setForm((current) => ({ ...current, targetDate: event.target.value }))} />
            </Field>
            <div className="sm:col-span-2">
              <Field label={t("计划备注")}>
                <Textarea rows={3} value={form.note} onChange={(event) => setForm((current) => ({ ...current, note: event.target.value }))} placeholder={t("记录备货原因、采购策略或其他说明")} />
              </Field>
            </div>
          </div>

          {saveError ? <p role="alert" className="shrink-0 break-words border-t border-rose-100 bg-rose-50 px-6 py-3 text-pretty text-sm text-rose-700">{saveError}</p> : null}
          <DialogFooter className="border-t border-slate-200 px-6 py-4">
            <Button type="button" variant="outline" disabled={saving} onClick={onClose}>{t("取消")}</Button>
            <Button type="submit" disabled={saving} className="bg-primary text-white hover:bg-primary-hover">
              {saving ? t("保存中...") : t(plan ? "保存修改" : "创建计划")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function StockPlanBatchDialog({
  plan,
  batch,
  onClose,
  onSaved,
}: {
  plan: ProcStockPlan;
  batch?: ProcStockPlanBatch;
  onClose: () => void;
  onSaved: (plan: ProcStockPlan) => void;
}) {
  const { t } = useI18n();
  const [form, setForm] = useState({
    supplierName: batch?.supplierName ?? "",
    purchaseQty: batch ? String(batch.purchaseQty) : "",
    purchaseOrderNo: batch?.purchaseOrderNo ?? "",
    orderDate: batch?.orderDate ?? "",
    expectedArrivalDate: batch?.expectedArrivalDate ?? "",
    note: batch?.note ?? "",
  });
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const openerRef = useRef(typeof document !== "undefined" && document.activeElement instanceof HTMLElement ? document.activeElement : null);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setSaveError(null);
    const purchaseQty = Number(form.purchaseQty);
    if (!form.supplierName.trim()) {
      setSaveError(t("请填写供应商"));
      return;
    }
    if (!Number.isFinite(purchaseQty) || purchaseQty <= 0) {
      setSaveError(t("本批采购量必须大于 0"));
      return;
    }
    const input: ProcStockPlanBatchInput = {
      supplierName: form.supplierName.trim(),
      purchaseQty,
      purchaseOrderNo: form.purchaseOrderNo.trim() || undefined,
      orderDate: form.orderDate || undefined,
      expectedArrivalDate: form.expectedArrivalDate || undefined,
      note: form.note.trim() || undefined,
    };
    setSaving(true);
    try {
      const saved = batch
        ? await updateProcStockPlanBatch(plan.id, batch.id, input)
        : await createProcStockPlanBatch(plan.id, input);
      onSaved(saved);
      toast.success(t(batch ? "采购批次已更新" : "采购批次已添加"));
      onClose();
    } catch (cause) {
      setSaveError(cause instanceof Error ? cause.message : t("保存失败"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => { if (!open && !saving) onClose(); }}>
      <DialogContent
        className="proc-horizon-overlay proc-stock-plan-form-dialog flex flex-col overflow-hidden p-0 sm:max-w-2xl"
        onCloseAutoFocus={(event) => {
          if (openerRef.current?.isConnected) { event.preventDefault(); openerRef.current.focus(); }
        }}
      >
        <form onSubmit={submit} className="flex min-h-0 flex-1 flex-col">
          <DialogHeader className="px-6 pb-4 pt-6 pr-14">
            <DialogTitle>{t(batch ? "编辑采购批次" : "添加采购批次")}</DialogTitle>
            <DialogDescription>
              {plan.materialName}，{t("目标")} {quantity(plan.targetQty)} {plan.unit || t("单位")}
              {plan.remainingQty > 0 ? `，${t("还需采购")} ${quantity(plan.remainingQty)}` : `，${t("目标已达成")}`}
            </DialogDescription>
          </DialogHeader>

          <div className="proc-stock-plan-form-fields grid min-h-0 gap-4 overflow-y-auto overscroll-contain px-6 pb-6 sm:grid-cols-2">
            <Field label={t("供应商")} required>
              <Input value={form.supplierName} onChange={(event) => setForm((current) => ({ ...current, supplierName: event.target.value }))} placeholder={t("填写本批供应商")} required autoFocus />
            </Field>
            <Field label={t("本批采购量")} required>
              <Input type="number" min="0.001" step="0.001" required value={form.purchaseQty} onChange={(event) => setForm((current) => ({ ...current, purchaseQty: event.target.value }))} placeholder="0" className="tabular-nums" />
            </Field>
            <Field label={t("采购单号")}>
              <Input value={form.purchaseOrderNo} onChange={(event) => setForm((current) => ({ ...current, purchaseOrderNo: event.target.value }))} placeholder={t("可选")}/>
            </Field>
            <Field label={t("下单日期")}>
              <Input type="date" value={form.orderDate} onChange={(event) => setForm((current) => ({ ...current, orderDate: event.target.value }))} />
            </Field>
            <Field label={t("预计到货日期")}>
              <Input type="date" value={form.expectedArrivalDate} onChange={(event) => setForm((current) => ({ ...current, expectedArrivalDate: event.target.value }))} />
            </Field>
            <div className="sm:col-span-2">
              <Field label={t("批次备注")}>
                <Textarea rows={3} value={form.note} onChange={(event) => setForm((current) => ({ ...current, note: event.target.value }))} placeholder={t("记录交期、付款或分批原因")} />
              </Field>
            </div>
          </div>

          {saveError ? <p role="alert" className="shrink-0 break-words border-t border-rose-100 bg-rose-50 px-6 py-3 text-pretty text-sm text-rose-700">{saveError}</p> : null}
          <DialogFooter className="border-t border-slate-200 px-6 py-4">
            <Button type="button" variant="outline" disabled={saving} onClick={onClose}>{t("取消")}</Button>
            <Button type="submit" disabled={saving} className="bg-primary text-white hover:bg-primary-hover">
              {saving ? t("保存中...") : t(batch ? "保存修改" : "添加批次")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function StockPlanPanel({ materials, canCreate }: { materials: Material[]; canCreate: boolean }) {
  const { t } = useI18n();
  const [plans, setPlans] = useState<ProcStockPlan[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [keyword, setKeyword] = useState("");
  const [status, setStatus] = useState<StatusFilter>("all");
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [editingPlan, setEditingPlan] = useState<ProcStockPlan | "new" | null>(null);
  const [editingBatch, setEditingBatch] = useState<{ plan: ProcStockPlan; batch?: ProcStockPlanBatch } | null>(null);
  const [deletingBatch, setDeletingBatch] = useState<{ plan: ProcStockPlan; batch: ProcStockPlanBatch } | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const deleteOpenerRef = useRef<HTMLButtonElement | null>(null);

  const changeKeyword = (value: string) => {
    setKeyword(value);
    if (listRef.current) listRef.current.scrollTop = 0;
  };
  const changeStatus = (value: StatusFilter) => {
    setStatus(value);
    if (listRef.current) listRef.current.scrollTop = 0;
  };
  const clearFilters = () => {
    changeKeyword("");
    changeStatus("all");
  };

  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setError(null);
    try {
      setPlans(await listProcStockPlans(signal));
    } catch (cause) {
      if (!signal?.aborted) setError(cause instanceof Error ? cause.message : t("备货计划加载失败"));
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  const replacePlan = (saved: ProcStockPlan) => {
    setPlans((current) => {
      const exists = current.some((plan) => plan.id === saved.id);
      return exists ? current.map((plan) => plan.id === saved.id ? saved : plan) : [saved, ...current];
    });
    if (saved.batches.length > 0) {
      setExpanded((current) => new Set(current).add(saved.id));
    }
  };

  const counts = useMemo(() => ({
    all: plans.length,
    not_started: plans.filter((plan) => plan.status === "not_started").length,
    in_progress: plans.filter((plan) => plan.status === "in_progress").length,
    completed: plans.filter((plan) => plan.status === "completed").length,
  }), [plans]);

  const filtered = useMemo(() => {
    const query = keyword.trim().toLocaleLowerCase("zh-CN");
    return plans.filter((plan) => {
      if (status !== "all" && plan.status !== status) return false;
      if (!query) return true;
      const haystack = [
        plan.code,
        plan.materialName,
        plan.spec,
        plan.note,
        plan.createdByName,
        ...plan.batches.flatMap((batch) => [batch.supplierName, batch.purchaseOrderNo, batch.note]),
      ].filter(Boolean).join(" ").toLocaleLowerCase("zh-CN");
      return haystack.includes(query);
    });
  }, [keyword, plans, status]);

  const removeBatch = async () => {
    if (!deletingBatch) return;
    setDeleteError(null);
    setDeleting(true);
    try {
      const saved = await deleteProcStockPlanBatch(deletingBatch.plan.id, deletingBatch.batch.id);
      replacePlan(saved);
      toast.success(t("采购批次已删除，计划进度已重新计算"));
      setDeletingBatch(null);
    } catch (cause) {
      setDeleteError(cause instanceof Error ? cause.message : t("删除失败"));
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div ref={panelRef} tabIndex={-1} className="proc-stock-plan-panel flex min-h-0 min-w-0 flex-1 flex-col gap-3">
      <section className="proc-horizon-command proc-horizon-command-cockpit">
        <div className="proc-horizon-command-layout">
          <div className="proc-horizon-command-heading">
            <span className="proc-horizon-command-mark"><PackagePlus aria-hidden="true" className="size-5" /></span>
            <div className="proc-horizon-command-copy">
              <h2>{t("备货计划")}</h2>
              <p>{t("采购自建总计划，可按批次和不同供应商拆分登记；累计采购量达到目标后自动完成。")}</p>
            </div>
          </div>
          <div className="proc-horizon-actions">
            <div className="proc-horizon-search">
              <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-slate-400" />
              <Input aria-label={t("搜索备货计划")} value={keyword} onChange={(event) => changeKeyword(event.target.value)} placeholder={t("计划编号 / 物料 / 供应商")} className="pl-8 pr-8 text-xs" />
              {keyword ? (
                <button type="button" aria-label={t("清空搜索")} onClick={() => changeKeyword("")} className="absolute right-2 top-1/2 flex size-7 -translate-y-1/2 items-center justify-center rounded-md text-slate-400 hover:bg-slate-100 hover:text-slate-700">
                  <X aria-hidden="true" className="size-3.5" />
                </button>
              ) : null}
            </div>
            {canCreate ? (
              <button type="button" onClick={() => setEditingPlan("new")} className="proc-horizon-primary-action inline-flex items-center gap-1.5 text-xs">
                <Plus aria-hidden="true" className="size-4" />{t("新建总计划")}
              </button>
            ) : null}
          </div>

          <div role="group" aria-label={t("计划状态筛选")} className="proc-horizon-kpi-grid proc-stock-plan-kpi-grid">
            {([
              ["all", "全部计划", PackagePlus],
              ["not_started", "未开始", CircleDashed],
              ["in_progress", "采购中", Truck],
              ["completed", "已完成", CheckCircle2],
            ] as const).map(([key, label, Icon]) => (
              <button
                key={key}
                type="button"
                data-active={status === key}
                aria-pressed={status === key}
                className="proc-horizon-kpi cursor-pointer text-left"
                onClick={() => changeStatus(key)}
              >
                <span className="proc-horizon-kpi-icon inline-flex items-center justify-center"><Icon aria-hidden="true" className="size-4" /></span>
                <span className="proc-horizon-kpi-value block tabular-nums">{loading ? "—" : counts[key]}</span>
                <span className="proc-horizon-kpi-label block">{t(label)}</span>
              </button>
            ))}
          </div>
        </div>
      </section>

      <section className="proc-horizon-task-feed flex min-h-0 flex-1 flex-col">
        <div className="proc-horizon-filter-bar">
          <span className="font-semibold text-slate-600">
            {status === "all" ? t("全部备货计划") : t(STATUS_LABELS[status])}
          </span>
          <div className="flex flex-wrap items-center gap-3">
            {status !== "all" || keyword.trim() ? <button type="button" onClick={clearFilters} className="text-xs font-semibold text-primary hover:underline">{t("清除筛选")}</button> : null}
            <span aria-live="polite" className="font-semibold tabular-nums text-slate-500">{loading ? t("正在加载备货计划") : t("显示 {count} 个计划", { count: filtered.length })}</span>
          </div>
        </div>

        <div ref={listRef} className="proc-stock-plan-scroll min-h-0 flex-1 overflow-y-auto overscroll-contain bg-background p-3">
          {error ? (
            <div role="alert" className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-rose-200 bg-rose-50/50 px-4 py-12 text-center text-sm text-rose-700">
              <AlertTriangle aria-hidden="true" className="size-7 text-rose-500" />
              <div className="min-w-0"><p className="font-semibold text-balance">{t("备货计划加载失败")}</p><p className="mt-1 break-words text-pretty text-xs">{error}</p></div>
              <Button type="button" variant="outline" size="sm" onClick={() => void load()}>{t("重新加载")}</Button>
            </div>
          ) : loading ? (
            <div role="status" aria-label={t("正在加载备货计划")} className="grid gap-2">
              {[0, 1, 2].map((item) => <div key={item} className="h-24 animate-pulse rounded-xl border border-slate-200 bg-white motion-reduce:animate-none" />)}
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-slate-200 bg-white px-4 py-14 text-center">
              <PackagePlus aria-hidden="true" className="size-8 text-slate-300" />
              <div>
                <p className="text-balance text-sm font-semibold text-slate-700">{t(plans.length ? "没有符合条件的备货计划" : "当前还没有备货计划")}</p>
                <p className="mt-1 text-pretty text-xs text-slate-500">{t(plans.length ? "可切换状态或修改搜索条件" : "创建总计划后，再逐批登记供应商和采购数量")}</p>
              </div>
              {canCreate && plans.length === 0 ? <Button type="button" size="sm" onClick={() => setEditingPlan("new")} className="bg-primary text-white hover:bg-primary-hover">{t("新建总计划")}</Button> : null}
              {plans.length > 0 ? <Button type="button" variant="outline" size="sm" onClick={clearFilters}>{t("清除筛选")}</Button> : null}
            </div>
          ) : (
            <div className="proc-stock-plan-list overflow-hidden rounded-xl border border-slate-200 bg-white">
              <div className="proc-stock-plan-table-header hidden items-center gap-3 border-b border-slate-200 bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-500" aria-hidden="true">
                <span />
                <span>{t("计划 / 物料")}</span>
                <span>{t("目标采购量")}</span>
                <span>{t("采购进度")}</span>
                <span>{t("计划日期")}</span>
                <span>{t("创建人")}</span>
                <span className="text-right">{t("操作")}</span>
              </div>

              {filtered.map((plan) => {
                const isExpanded = expanded.has(plan.id);
                const overQty = Math.max(plan.purchasedQty - plan.targetQty, 0);
                const supplierCount = new Set(plan.batches.map((batch) => batch.supplierName)).size;
                return (
                  <article key={plan.id} aria-label={`${plan.code} · ${plan.materialName}`} className="proc-stock-plan-item border-b border-slate-100 last:border-b-0">
                    <div className="proc-stock-plan-row grid min-w-0 items-center gap-3 px-3 py-3">
                      <button
                        type="button"
                        aria-label={`${t(isExpanded ? "收起采购批次" : "展开采购批次")} · ${plan.materialName}`}
                        aria-controls={`proc-stock-plan-batches-${plan.id}`}
                        aria-expanded={isExpanded}
                        onClick={() => setExpanded((current) => {
                          const next = new Set(current);
                          if (next.has(plan.id)) next.delete(plan.id); else next.add(plan.id);
                          return next;
                        })}
                        className="proc-stock-plan-toggle flex size-9 shrink-0 items-center justify-center rounded-md text-slate-500 hover:bg-accent hover:text-primary"
                      >
                        {isExpanded ? <ChevronDown aria-hidden="true" className="size-4" /> : <ChevronRight aria-hidden="true" className="size-4" />}
                      </button>

                      <div className="proc-stock-plan-material min-w-0">
                        <div className="flex min-w-0 flex-wrap items-center gap-2">
                          <strong title={plan.materialName} className="min-w-0 break-words text-balance text-sm text-foreground">{plan.materialName}</strong>
                          <PlanStatus status={plan.status} />
                        </div>
                        <p title={`${plan.code}${plan.spec ? ` · ${plan.spec}` : ""}`} className="mt-1 break-words text-xs text-slate-500"><span className="font-medium tabular-nums">{plan.code}</span>{plan.spec ? ` · ${plan.spec}` : ""}</p>
                        {plan.note ? <p title={plan.note} className="mt-1 line-clamp-2 break-words text-pretty text-xs text-slate-500">{plan.note}</p> : null}
                      </div>

                      <div className="proc-stock-plan-target min-w-0 break-words text-sm tabular-nums text-slate-700">
                        <span className="proc-stock-plan-field-label mb-1 block text-xs font-medium text-slate-500">{t("目标采购量")}</span>
                        <strong className="text-foreground">{quantity(plan.targetQty)}</strong> <span className="text-xs text-slate-500">{plan.unit}</span>
                      </div>

                      <div className="proc-stock-plan-progress min-w-0">
                        <span className="proc-stock-plan-field-label mb-1 block text-xs font-medium text-slate-500">{t("采购进度")}</span>
                        <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1 text-xs">
                          <span className="font-semibold tabular-nums text-foreground">{quantity(plan.purchasedQty)} / {quantity(plan.targetQty)}</span>
                          <span className="tabular-nums text-slate-500">{Math.round(plan.progress)}%</span>
                        </div>
                        <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-slate-100">
                          <div className={cn("h-full rounded-full", plan.status === "completed" ? "bg-emerald-500" : "bg-primary")} style={{ width: `${Math.min(100, Math.max(0, plan.progress))}%` }} />
                        </div>
                        <p className="mt-1 text-[10px] text-slate-500">
                          {overQty > 0 ? `${t("超出目标")} ${quantity(overQty)}` : `${t("剩余")} ${quantity(plan.remainingQty)}`}
                        </p>
                      </div>

                      <div className="proc-stock-plan-date min-w-0 break-words text-xs text-slate-600">
                        <span className="proc-stock-plan-field-label mb-1 block text-xs font-medium text-slate-500">{t("计划日期")}</span>
                        <span className="inline-flex flex-wrap items-center gap-1 tabular-nums"><CalendarClock aria-hidden="true" className="size-3.5 text-slate-400" />{plan.targetDate || t("未设置")}</span>
                      </div>

                      <div className="proc-stock-plan-creator min-w-0 break-words text-xs text-slate-600">
                        <span className="proc-stock-plan-field-label mb-1 block text-xs font-medium text-slate-500">{t("创建人")}</span>
                        <p className="font-medium">{plan.createdByName || t("未知")}</p>
                        <p className="mt-0.5 tabular-nums text-xs text-slate-500">{plan.createdAt.slice(0, 10)}</p>
                      </div>

                      <div className="proc-stock-plan-row-actions flex flex-wrap items-center justify-end gap-1">
                        {canCreate ? (
                          <>
                            <button type="button" onClick={() => setEditingPlan(plan)} className="inline-flex h-8 items-center gap-1 rounded-md px-2 text-xs font-medium text-slate-600 hover:bg-slate-100 hover:text-primary" aria-label={t("编辑总计划")}>
                              <Pencil aria-hidden="true" className="size-3.5" /><span>{t("编辑")}</span>
                            </button>
                            <button type="button" onClick={() => setEditingBatch({ plan })} className="inline-flex h-8 items-center gap-1 rounded-md bg-accent px-2 text-xs font-semibold text-primary hover:bg-primary/10" aria-label={t("添加采购批次")}>
                              <Plus aria-hidden="true" className="size-3.5" />{t("加批次")}
                            </button>
                          </>
                        ) : null}
                      </div>
                    </div>

                    {isExpanded ? (
                      <div id={`proc-stock-plan-batches-${plan.id}`} className="proc-stock-plan-batches min-w-0 border-t border-slate-100 bg-slate-50/70 px-3 py-3">
                        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                          <p className="text-xs font-semibold text-slate-600">
                            {t("采购批次")} <span className="ml-1 font-normal text-slate-500">{plan.batches.length} {t("批")}，{supplierCount} {t("家供应商")}</span>
                          </p>
                          {canCreate ? <button type="button" onClick={() => setEditingBatch({ plan })} className="inline-flex items-center gap-1 text-xs font-semibold text-primary hover:underline"><Plus aria-hidden="true" className="size-3.5" />{t("添加批次")}</button> : null}
                        </div>
                        {plan.batches.length === 0 ? (
                          <div className="rounded-lg border border-dashed border-slate-200 bg-white px-4 py-6 text-center text-xs text-slate-500">
                            {t("尚未登记采购批次，总计划仍为未开始")}
                          </div>
                        ) : (
                          <div className="grid gap-2">
                            {plan.batches.map((batch, index) => (
                              <div key={batch.id} className="proc-stock-plan-batch-row grid min-w-0 gap-3 rounded-lg border border-slate-200 bg-white p-3">
                                <div className="min-w-0">
                                  <p title={batch.supplierName} className="break-words text-pretty text-xs font-semibold text-foreground">{t("第 {count} 批", { count: index + 1 })} · {batch.supplierName}</p>
                                  <p className="mt-1 break-words text-xs text-slate-500">{batch.createdByName || t("未知")}，{batch.createdAt.slice(0, 10)}</p>
                                </div>
                                <div className="min-w-0 break-words text-xs text-slate-600"><span className="mr-1 text-slate-500">{t("采购量")}</span><strong className="tabular-nums text-foreground">{quantity(batch.purchaseQty)} {plan.unit}</strong></div>
                                <div className="min-w-0 break-words text-xs text-slate-600"><span className="mr-1 text-slate-500">{t("采购单")}</span>{batch.purchaseOrderNo || t("未填写")}</div>
                                <div className="proc-stock-plan-batch-dates min-w-0 break-words text-xs text-slate-600">
                                  <p className="tabular-nums">{t("下单")}：{batch.orderDate || t("未设置")}</p>
                                  <p className="mt-1 tabular-nums">{t("预计到货")}：{batch.expectedArrivalDate || t("未设置")}</p>
                                  {batch.note ? <p className="mt-1 break-words text-pretty text-slate-500">{batch.note}</p> : null}
                                </div>
                                {canCreate ? (
                                  <div className="proc-stock-plan-batch-actions flex justify-end gap-1">
                                    <button type="button" onClick={() => setEditingBatch({ plan, batch })} className="flex size-8 items-center justify-center rounded-md text-slate-500 hover:bg-accent hover:text-primary" aria-label={t("编辑采购批次")}><Pencil aria-hidden="true" className="size-3.5" /></button>
                                    <button type="button" onClick={(event) => { deleteOpenerRef.current = event.currentTarget; setDeleteError(null); setDeletingBatch({ plan, batch }); }} className="flex size-8 items-center justify-center rounded-md text-slate-500 hover:bg-rose-50 hover:text-rose-700" aria-label={t("删除采购批次")}><Trash2 aria-hidden="true" className="size-3.5" /></button>
                                  </div>
                                ) : null}
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    ) : null}
                  </article>
                );
              })}
            </div>
          )}
        </div>
      </section>

      {editingPlan ? (
        <StockPlanFormDialog
          plan={editingPlan === "new" ? undefined : editingPlan}
          materials={materials}
          onClose={() => setEditingPlan(null)}
          onSaved={replacePlan}
        />
      ) : null}
      {editingBatch ? (
        <StockPlanBatchDialog
          plan={plans.find((plan) => plan.id === editingBatch.plan.id) ?? editingBatch.plan}
          batch={editingBatch.batch}
          onClose={() => setEditingBatch(null)}
          onSaved={replacePlan}
        />
      ) : null}

      <AlertDialog open={Boolean(deletingBatch)} onOpenChange={(open) => { if (!open && !deleting) setDeletingBatch(null); }}>
        <AlertDialogContent
          className="proc-horizon-overlay"
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            const opener = deleteOpenerRef.current;
            (opener?.isConnected ? opener : panelRef.current)?.focus();
          }}
        >
          <AlertDialogHeader>
            <AlertDialogTitle>{t("删除采购批次？")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("删除后会从累计采购量中扣除本批数量，计划状态将自动重新计算。")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {deleteError ? <p role="alert" className="rounded-lg bg-rose-50 p-3 text-pretty text-sm text-rose-700">{deleteError}</p> : null}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>{t("取消")}</AlertDialogCancel>
            <AlertDialogAction disabled={deleting} onClick={(event) => { event.preventDefault(); void removeBatch(); }} className="bg-rose-600 text-white hover:bg-rose-700">
              {deleting ? t("删除中...") : t("确认删除")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
