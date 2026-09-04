import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
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

function dateLabel(value?: string) {
  return value || "未设置";
}

function PlanStatus({ status }: { status: ProcStockPlanStatus }) {
  const Icon = status === "completed" ? CheckCircle2 : status === "in_progress" ? Truck : CircleDashed;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-semibold",
        status === "completed" && "bg-emerald-50 text-emerald-700",
        status === "in_progress" && "bg-[#eef3ff] text-[#002fa7]",
        status === "not_started" && "bg-slate-100 text-slate-600",
      )}
    >
      <Icon aria-hidden="true" className="size-3.5" />
      {STATUS_LABELS[status]}
    </span>
  );
}

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <label className="grid gap-1.5 text-xs font-semibold text-slate-600">
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
    const targetQty = Number(form.targetQty);
    if (!form.materialName.trim()) {
      toast.error(t("请填写物料名称"));
      return;
    }
    if (!Number.isFinite(targetQty) || targetQty <= 0) {
      toast.error(t("目标采购量必须大于 0"));
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
      toast.error(cause instanceof Error ? cause.message : t("保存失败"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="proc-horizon-overlay sm:max-w-2xl">
        <form onSubmit={submit} className="grid gap-5">
          <DialogHeader>
            <DialogTitle>{t(plan ? "编辑备货总计划" : "新建备货总计划")}</DialogTitle>
            <DialogDescription>{t("先设定总采购量，后续可按采购批次和供应商逐笔登记。")}</DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t("物料名称")} required>
              <Input
                list="proc-stock-plan-material-options"
                value={form.materialName}
                onChange={(event) => changeMaterial(event.target.value)}
                placeholder={t("输入或选择物料")}
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
              <Input type="number" min="0.001" step="0.001" value={form.targetQty} onChange={(event) => setForm((current) => ({ ...current, targetQty: event.target.value }))} placeholder="0" />
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

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>{t("取消")}</Button>
            <Button type="submit" disabled={saving} className="bg-[#002fa7] text-white hover:bg-[#002581]">
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

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const purchaseQty = Number(form.purchaseQty);
    if (!form.supplierName.trim()) {
      toast.error(t("请填写供应商"));
      return;
    }
    if (!Number.isFinite(purchaseQty) || purchaseQty <= 0) {
      toast.error(t("本批采购量必须大于 0"));
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
      toast.error(cause instanceof Error ? cause.message : t("保存失败"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="proc-horizon-overlay sm:max-w-2xl">
        <form onSubmit={submit} className="grid gap-5">
          <DialogHeader>
            <DialogTitle>{t(batch ? "编辑采购批次" : "添加采购批次")}</DialogTitle>
            <DialogDescription>
              {plan.materialName}，{t("目标")} {quantity(plan.targetQty)} {plan.unit || t("单位")}
              {plan.remainingQty > 0 ? `，${t("还需采购")} ${quantity(plan.remainingQty)}` : `，${t("目标已达成")}`}
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t("供应商")} required>
              <Input value={form.supplierName} onChange={(event) => setForm((current) => ({ ...current, supplierName: event.target.value }))} placeholder={t("填写本批供应商")} autoFocus />
            </Field>
            <Field label={t("本批采购量")} required>
              <Input type="number" min="0.001" step="0.001" value={form.purchaseQty} onChange={(event) => setForm((current) => ({ ...current, purchaseQty: event.target.value }))} placeholder="0" />
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

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>{t("取消")}</Button>
            <Button type="submit" disabled={saving} className="bg-[#002fa7] text-white hover:bg-[#002581]">
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
    setDeleting(true);
    try {
      const saved = await deleteProcStockPlanBatch(deletingBatch.plan.id, deletingBatch.batch.id);
      replacePlan(saved);
      toast.success(t("采购批次已删除，计划进度已重新计算"));
      setDeletingBatch(null);
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : t("删除失败"));
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
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
              <Input aria-label={t("搜索备货计划")} value={keyword} onChange={(event) => setKeyword(event.target.value)} placeholder={t("计划编号 / 物料 / 供应商")} className="pl-8 pr-8 text-xs" />
              {keyword ? (
                <button type="button" aria-label={t("清空搜索")} onClick={() => setKeyword("")} className="absolute right-2 top-1/2 flex size-7 -translate-y-1/2 items-center justify-center rounded-md text-slate-400 hover:bg-slate-100 hover:text-slate-700">
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

          <div className="proc-horizon-kpi-grid proc-stock-plan-kpi-grid">
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
                className="proc-horizon-kpi cursor-pointer text-left"
                onClick={() => setStatus(key)}
              >
                <span className="proc-horizon-kpi-icon inline-flex items-center justify-center"><Icon aria-hidden="true" className="size-4" /></span>
                <span className="proc-horizon-kpi-value block">{counts[key]}</span>
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
          <span className="font-semibold tabular-nums text-slate-500">{t("显示 {count} 个计划", { count: filtered.length })}</span>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto bg-[#f7f9fc] p-3">
          {error ? (
            <div role="alert" className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-rose-200 bg-rose-50/50 px-4 py-12 text-center text-sm text-rose-700">
              <AlertTriangle aria-hidden="true" className="size-7 text-rose-500" />
              <div><p className="font-semibold">{t("备货计划加载失败")}</p><p className="mt-1 text-xs">{error}</p></div>
              <Button type="button" variant="outline" size="sm" onClick={() => void load()}>{t("重新加载")}</Button>
            </div>
          ) : loading ? (
            <div aria-label={t("正在加载备货计划")} className="grid gap-2">
              {[0, 1, 2].map((item) => <div key={item} className="h-24 animate-pulse rounded-xl border border-slate-200 bg-white motion-reduce:animate-none" />)}
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-slate-200 bg-white px-4 py-14 text-center">
              <PackagePlus aria-hidden="true" className="size-8 text-slate-300" />
              <div>
                <p className="text-sm font-semibold text-slate-700">{t(plans.length ? "没有符合条件的备货计划" : "当前还没有备货计划")}</p>
                <p className="mt-1 text-xs text-slate-500">{t(plans.length ? "可切换状态或修改搜索条件" : "创建总计划后，再逐批登记供应商和采购数量")}</p>
              </div>
              {canCreate && plans.length === 0 ? <Button type="button" size="sm" onClick={() => setEditingPlan("new")} className="bg-[#002fa7] text-white hover:bg-[#002581]">{t("新建总计划")}</Button> : null}
            </div>
          ) : (
            <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
              <div className="hidden grid-cols-[2.25rem_minmax(12rem,1.45fr)_minmax(7rem,.72fr)_minmax(12rem,1.05fr)_minmax(7rem,.65fr)_minmax(7rem,.65fr)_auto] items-center gap-3 border-b border-slate-200 bg-slate-50 px-3 py-2 text-[11px] font-semibold text-slate-500 lg:grid">
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
                  <article key={plan.id} className="border-b border-slate-100 last:border-b-0">
                    <div className="grid grid-cols-2 items-center gap-3 px-3 py-3 lg:grid-cols-[2.25rem_minmax(12rem,1.45fr)_minmax(7rem,.72fr)_minmax(12rem,1.05fr)_minmax(7rem,.65fr)_minmax(7rem,.65fr)_auto]">
                      <button
                        type="button"
                        aria-label={t(isExpanded ? "收起采购批次" : "展开采购批次")}
                        aria-expanded={isExpanded}
                        onClick={() => setExpanded((current) => {
                          const next = new Set(current);
                          if (next.has(plan.id)) next.delete(plan.id); else next.add(plan.id);
                          return next;
                        })}
                        className="flex size-8 items-center justify-center rounded-md text-slate-500 hover:bg-[#eef3ff] hover:text-[#002fa7]"
                      >
                        {isExpanded ? <ChevronDown aria-hidden="true" className="size-4" /> : <ChevronRight aria-hidden="true" className="size-4" />}
                      </button>

                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <strong className="truncate text-sm text-[#1b2559]">{plan.materialName}</strong>
                          <PlanStatus status={plan.status} />
                        </div>
                        <p className="mt-1 truncate text-xs text-slate-500"><span className="font-medium tabular-nums">{plan.code}</span>{plan.spec ? ` · ${plan.spec}` : ""}</p>
                        {plan.note ? <p className="mt-1 line-clamp-1 text-xs text-slate-500">{plan.note}</p> : null}
                      </div>

                      <div className="text-sm tabular-nums text-slate-700">
                        <span className="mb-1 block text-[10px] font-semibold text-slate-400 lg:hidden">{t("目标采购量")}</span>
                        <strong className="text-[#1b2559]">{quantity(plan.targetQty)}</strong> <span className="text-xs text-slate-500">{plan.unit}</span>
                      </div>

                      <div className="min-w-0">
                        <span className="mb-1 block text-[10px] font-semibold text-slate-400 lg:hidden">{t("采购进度")}</span>
                        <div className="flex items-center justify-between gap-2 text-xs">
                          <span className="font-semibold tabular-nums text-[#1b2559]">{quantity(plan.purchasedQty)} / {quantity(plan.targetQty)}</span>
                          <span className="tabular-nums text-slate-500">{Math.round(plan.progress)}%</span>
                        </div>
                        <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-slate-100">
                          <div className={cn("h-full rounded-full", plan.status === "completed" ? "bg-emerald-500" : "bg-[#002fa7]")} style={{ width: `${plan.progress}%` }} />
                        </div>
                        <p className="mt-1 text-[10px] text-slate-500">
                          {overQty > 0 ? `${t("超出目标")} ${quantity(overQty)}` : `${t("剩余")} ${quantity(plan.remainingQty)}`}
                        </p>
                      </div>

                      <div className="text-xs text-slate-600">
                        <span className="mb-1 block text-[10px] font-semibold text-slate-400 lg:hidden">{t("计划日期")}</span>
                        <span className="inline-flex items-center gap-1"><CalendarClock aria-hidden="true" className="size-3.5 text-slate-400" />{dateLabel(plan.targetDate)}</span>
                      </div>

                      <div className="text-xs text-slate-600">
                        <span className="mb-1 block text-[10px] font-semibold text-slate-400 lg:hidden">{t("创建人")}</span>
                        <p className="font-medium">{plan.createdByName || t("未知")}</p>
                        <p className="mt-0.5 text-[10px] text-slate-400">{plan.createdAt.slice(0, 10)}</p>
                      </div>

                      <div className="col-span-2 flex items-center justify-end gap-1 lg:col-span-1">
                        {canCreate ? (
                          <>
                            <button type="button" onClick={() => setEditingPlan(plan)} className="inline-flex h-8 items-center gap-1 rounded-md px-2 text-xs font-medium text-slate-600 hover:bg-slate-100 hover:text-[#002fa7]" aria-label={t("编辑总计划")}>
                              <Pencil aria-hidden="true" className="size-3.5" /><span className="hidden xl:inline">{t("编辑")}</span>
                            </button>
                            <button type="button" onClick={() => setEditingBatch({ plan })} className="inline-flex h-8 items-center gap-1 rounded-md bg-[#eef3ff] px-2 text-xs font-semibold text-[#002fa7] hover:bg-[#e1eaff]" aria-label={t("添加采购批次")}>
                              <Plus aria-hidden="true" className="size-3.5" />{t("加批次")}
                            </button>
                          </>
                        ) : null}
                      </div>
                    </div>

                    {isExpanded ? (
                      <div className="border-t border-slate-100 bg-slate-50/70 px-3 py-3 lg:pl-[3.5rem]">
                        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                          <p className="text-xs font-semibold text-slate-600">
                            {t("采购批次")} <span className="ml-1 font-normal text-slate-500">{plan.batches.length} {t("批")}，{supplierCount} {t("家供应商")}</span>
                          </p>
                          {canCreate ? <button type="button" onClick={() => setEditingBatch({ plan })} className="inline-flex items-center gap-1 text-xs font-semibold text-[#002fa7] hover:underline"><Plus aria-hidden="true" className="size-3.5" />{t("添加批次")}</button> : null}
                        </div>
                        {plan.batches.length === 0 ? (
                          <div className="rounded-lg border border-dashed border-slate-200 bg-white px-4 py-6 text-center text-xs text-slate-500">
                            {t("尚未登记采购批次，总计划仍为未开始")}
                          </div>
                        ) : (
                          <div className="grid gap-2">
                            {plan.batches.map((batch, index) => (
                              <div key={batch.id} className="grid gap-3 rounded-lg border border-slate-200 bg-white p-3 md:grid-cols-[minmax(8rem,1fr)_minmax(6rem,.55fr)_minmax(8rem,.8fr)_minmax(10rem,1fr)_auto] md:items-center">
                                <div className="min-w-0">
                                  <p className="text-xs font-semibold text-[#1b2559]">{t("第 {count} 批", { count: index + 1 })} · {batch.supplierName}</p>
                                  <p className="mt-1 text-[11px] text-slate-500">{batch.createdByName || t("未知")}，{batch.createdAt.slice(0, 10)}</p>
                                </div>
                                <div className="text-xs text-slate-600"><span className="mr-1 text-slate-400">{t("采购量")}</span><strong className="tabular-nums text-[#1b2559]">{quantity(batch.purchaseQty)} {plan.unit}</strong></div>
                                <div className="text-xs text-slate-600"><span className="mr-1 text-slate-400">{t("采购单")}</span>{batch.purchaseOrderNo || t("未填写")}</div>
                                <div className="text-xs text-slate-600">
                                  <p>{t("下单")}：{dateLabel(batch.orderDate)}</p>
                                  <p className="mt-1">{t("预计到货")}：{dateLabel(batch.expectedArrivalDate)}</p>
                                  {batch.note ? <p className="mt-1 text-slate-500">{batch.note}</p> : null}
                                </div>
                                {canCreate ? (
                                  <div className="flex justify-end gap-1">
                                    <button type="button" onClick={() => setEditingBatch({ plan, batch })} className="flex size-8 items-center justify-center rounded-md text-slate-500 hover:bg-[#eef3ff] hover:text-[#002fa7]" aria-label={t("编辑采购批次")}><Pencil aria-hidden="true" className="size-3.5" /></button>
                                    <button type="button" onClick={() => setDeletingBatch({ plan, batch })} className="flex size-8 items-center justify-center rounded-md text-slate-500 hover:bg-rose-50 hover:text-rose-700" aria-label={t("删除采购批次")}><Trash2 aria-hidden="true" className="size-3.5" /></button>
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
        <AlertDialogContent className="proc-horizon-overlay">
          <AlertDialogHeader>
            <AlertDialogTitle>{t("删除采购批次？")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("删除后会从累计采购量中扣除本批数量，计划状态将自动重新计算。")}
            </AlertDialogDescription>
          </AlertDialogHeader>
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
