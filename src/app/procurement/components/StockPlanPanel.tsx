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
import { useNavigate, useSearchParams } from "react-router";
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import { refreshProcurement, useProcurementProducts } from "../data";

import { useI18n } from "../../lib/i18n";
import {
  createProcStockPlan,
  createProcStockPlanBatch,
  deleteProcStockPlanBatch,
  generateProcStockPlanTasks,
  getProcStockPlanReadiness,
  getInventoryReadiness,
  listProcTaskTree,
  listPoMirror,
  listQuoteSuppliers,
  listProcStockPlans,
  updateProcStockPlan,
  updateProcStockPlanBatch,
  type Material,
  type ProcStockPlan,
  type ProcStockPlanBatch,
  type ProcStockPlanBatchInput,
  type ProcStockPlanInput,
  type ProcStockPlanStatus,
  type ProcStockPlanType,
  type ProcTaskTreeNode,
  type InventoryReadinessResponse,
  type PoMirrorRow,
  type SupplierOption,
} from "../../lib/procurementApi";
import { SubsystemOperationsPanel } from "./SubsystemOperationsPanel";
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
  not_started: "未下单",
  in_progress: "下单中",
  completed: "下单达标",
};
const PLAN_TYPE_LABELS: Record<ProcStockPlanType, string> = { machine: "整机", packaging: "包材", material: "物料" };
const SELECT_CLASS = "h-9 w-full rounded-md border border-slate-200 bg-white px-3 text-sm text-slate-700 disabled:bg-slate-100";

function flattenNodes(nodes: ProcTaskTreeNode[], prefix = ""): Array<{id: string; name: string}> {
  return nodes.flatMap((node) => {
    const name = prefix ? `${prefix} / ${node.name}` : node.name;
    return [{id: node.id, name}, ...flattenNodes(node.children, name)];
  });
}

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
  defaults,
}: {
  plan?: ProcStockPlan;
  materials: Material[];
  onClose: () => void;
  onSaved: (plan: ProcStockPlan) => void;
  defaults?: Partial<ProcStockPlanInput>;
}) {
  const { t } = useI18n();
  const products = useProcurementProducts();
  const [nodes, setNodes] = useState<Array<{id: string; name: string}>>([]);
  const [models, setModels] = useState<InventoryReadinessResponse["models"]>([]);
  const [contextError, setContextError] = useState("");
  const targetLocked = Boolean(plan?.tasks?.length);
  const locked = plan?.contextLocked ?? targetLocked;
  const materialLocked = plan?.materialLocked ?? (locked || Boolean(plan?.batches.length));
  const [form, setForm] = useState({
    planType: plan?.planType ?? defaults?.planType ?? "material",
    productId: plan?.productId ?? defaults?.productId ?? "",
    treeNodeId: plan?.treeNodeId ?? defaults?.treeNodeId ?? "",
    productLine: plan?.productLine ?? defaults?.productLine ?? "",
    productionTaskId: plan?.productionTaskId ?? defaults?.productionTaskId ?? "",
    materialId: plan?.materialId ?? defaults?.materialId ?? "",
    materialName: plan?.materialName ?? defaults?.materialName ?? "",
    spec: plan?.spec ?? defaults?.spec ?? "",
    unit: plan?.unit ?? defaults?.unit ?? "",
    targetQty: plan ? String(plan.targetQty) : defaults?.targetQty ? String(defaults.targetQty) : "",
    targetDate: plan?.targetDate ?? defaults?.targetDate ?? "",
    note: plan?.note ?? defaults?.note ?? "",
  });
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  useEffect(() => {
    if (!form.productId) { setNodes([]); return; }
    const controller = new AbortController();
    setContextError("");
    void listProcTaskTree(form.productId, controller.signal)
      .then((data) => { if (!controller.signal.aborted) setNodes(flattenNodes(data.roots)); })
      .catch((error) => { if (!controller.signal.aborted) setContextError(error.message); });
    return () => controller.abort();
  }, [form.productId]);
  useEffect(() => {
    if (form.planType !== "machine") return;
    const controller = new AbortController();
    void getInventoryReadiness({targetSets: 0}, controller.signal)
      .then((data) => { if (!controller.signal.aborted) setModels(data.models); })
      .catch((error) => { if (!controller.signal.aborted) setContextError(error.message); });
    return () => controller.abort();
  }, [form.planType]);

  const changeMaterial = (value: string) => {
    const matches = materials.filter((material) => material.name === value);
    const match = matches.length === 1 ? matches[0] : undefined;
    setForm((current) => ({
      ...current,
      materialName: value,
      materialId: match?.id ?? "",
      spec: match?.spec ?? current.spec,
      unit: current.planType === "machine" ? "套" : match?.unit ?? current.unit,
    }));
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (savingRef.current) return;
    const targetQty = Number(form.targetQty);
    if (!form.materialName.trim()) {
      toast.error(t("请填写物料名称"));
      return;
    }
    if (!Number.isFinite(targetQty) || targetQty <= 0) {
      toast.error(t("目标备货量必须大于 0"));
      return;
    }
    const input: ProcStockPlanInput = {
      planType: form.planType,
      productId: form.productId,
      treeNodeId: form.treeNodeId,
      productLine: form.productLine,
      productionTaskId: form.productionTaskId,
      materialId: form.materialId,
      materialName: form.materialName.trim(),
      spec: form.spec.trim(),
      unit: form.unit.trim(),
      targetQty,
      targetDate: form.targetDate,
      note: form.note.trim(),
    };
    savingRef.current = true;
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
      savingRef.current = false;
      setSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => { if (!open && !savingRef.current) onClose(); }}>
      <DialogContent className="proc-horizon-overlay max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
        <form onSubmit={submit} className="grid gap-5">
          <DialogHeader>
            <DialogTitle>{t(plan ? "编辑备货总计划" : "新建备货总计划")}</DialogTitle>
            <DialogDescription>{t("整机按 BOM 查看物料齐套，包材和物料按本身数量备货。下单、到货与合格进度分别记录。")}</DialogDescription>
          </DialogHeader>
          {contextError && <p role="alert" className="text-xs text-rose-600">{contextError}</p>}
          {locked && <p className="text-xs text-slate-500">{t(targetLocked ? "已生成采购任务，计划来源和目标量已锁定。" : "已有生产或质量记录，计划归属和物料已锁定。")}</p>}
          {form.productionTaskId && <p className="text-xs text-slate-500">{t("来自生产任务")}：{form.productionTaskId}</p>}
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t("计划类型")} required>
              <select className={SELECT_CLASS} disabled={materialLocked} value={form.planType} onChange={(e) => setForm((v) => ({...v, planType: e.target.value as ProcStockPlanType, unit: e.target.value === "machine" ? "套" : v.unit, productLine: ""}))}>
                {Object.entries(PLAN_TYPE_LABELS).map(([value, label]) => <option key={value} value={value}>{t(label)}</option>)}
              </select>
            </Field>
            <Field label={t("所属产品")}>
              <select className={SELECT_CLASS} disabled={locked || Boolean(defaults?.productId)} value={form.productId} onChange={(e) => setForm((v) => ({...v, productId: e.target.value, treeNodeId: ""}))}>
                <option value="">{t("请选择产品")}</option>
                {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </Field>
            <Field label={t("所属子系统")}>
              <select className={SELECT_CLASS} disabled={locked || !form.productId || Boolean(defaults?.treeNodeId)} value={form.treeNodeId} onChange={(e) => setForm((v) => ({...v, treeNodeId: e.target.value}))}>
                <option value="">{t("请选择子系统")}</option>
                {nodes.map((node) => <option key={node.id} value={node.id}>{node.name}</option>)}
              </select>
            </Field>
            {form.planType === "machine" && <Field label={t("整机 BOM 型号")} required>
              <select required className={SELECT_CLASS} disabled={materialLocked} value={form.productLine} onChange={(e) => setForm((v) => ({...v, productLine: e.target.value}))}>
                <option value="">{t("选择 BOM 型号")}</option>
                {models.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
              </select>
            </Field>}
            <Field label={t("物料名称")} required>
              <Input
                list="proc-stock-plan-material-options"
                value={form.materialName}
                onChange={(event) => changeMaterial(event.target.value)}
                placeholder={t("输入或选择物料")}
                autoFocus
                disabled={materialLocked}
              />
              <datalist id="proc-stock-plan-material-options">
                {materials.map((material) => (
                  <option key={material.id} value={material.name}>{material.spec}</option>
                ))}
              </datalist>
            </Field>
            <Field label={t("关联物料编码")}>
              <select className={SELECT_CLASS} disabled={materialLocked} value={form.materialId} onChange={(e) => {
                const material = materials.find((m) => m.id === e.target.value);
                setForm((v) => ({...v, materialId: e.target.value, ...(material ? {materialName: material.name, spec: material.spec, unit: form.planType === "machine" ? "套" : material.unit} : {})}));
              }}>
                <option value="">{t("未关联（单物料生成采购任务前须关联）")}</option>
                {materials.filter((m) => !form.materialName || m.name.includes(form.materialName) || m.id === form.materialId).map((m) => <option key={m.id} value={m.id}>{m.tpInventoryCode || m.erpCode || "未编码"} · {m.name} · {m.spec}</option>)}
              </select>
            </Field>
            <Field label={t("规格型号")}>
              <Input disabled={materialLocked} value={form.spec} onChange={(event) => setForm((current) => ({ ...current, spec: event.target.value }))} placeholder={t("可选")} />
            </Field>
            <Field label={t("目标备货量")} required>
              <Input disabled={targetLocked} type="number" min={form.planType === "machine" ? "1" : "0.001"} step={form.planType === "machine" ? "1" : "0.001"} value={form.targetQty} onChange={(event) => setForm((current) => ({ ...current, targetQty: event.target.value }))} placeholder="0" />
            </Field>
            <Field label={t("单位")}>
              <Input disabled={materialLocked || form.planType === "machine" || Boolean(form.materialId)} value={form.unit} onChange={(event) => setForm((current) => ({ ...current, unit: event.target.value }))} placeholder={t("如：件、套、kg")} />
            </Field>
            <Field label={t("计划完成日期")}>
              <Input disabled={targetLocked} type="date" value={form.targetDate} onChange={(event) => setForm((current) => ({ ...current, targetDate: event.target.value }))} />
            </Field>
            <div className="sm:col-span-2">
              <Field label={t("计划备注")}>
                <Textarea rows={3} value={form.note} onChange={(event) => setForm((current) => ({ ...current, note: event.target.value }))} placeholder={t("记录备货原因、采购策略或其他说明")} />
              </Field>
            </div>
          </div>

          <DialogFooter>
            <Button type="button" disabled={saving} variant="outline" onClick={onClose}>{t("取消")}</Button>
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
  const [mirrors, setMirrors] = useState<PoMirrorRow[]>([]);
  const [suppliers, setSuppliers] = useState<SupplierOption[]>([]);
  const [optionsError, setOptionsError] = useState("");
  const [form, setForm] = useState({
    purchaseOrderMirrorId: batch?.purchaseOrderMirrorId ?? "",
    supplierId: batch?.supplierId ?? "",
    supplierName: batch?.supplierName ?? "",
    purchaseQty: batch ? String(batch.recordedPurchaseQty ?? batch.purchaseQty) : "",
    purchaseOrderNo: batch?.purchaseOrderNo ?? "",
    orderDate: batch?.orderDate ?? "",
    expectedArrivalDate: batch?.expectedArrivalDate ?? "",
    receivedQty: String(batch?.recordedReceivedQty ?? batch?.receivedQty ?? 0),
    qualifiedQty: String(batch?.recordedQualifiedQty ?? batch?.qualifiedQty ?? 0),
    actualArrivalDate: batch?.actualArrivalDate ?? "",
    note: batch?.note ?? "",
  });
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  useEffect(() => {
    let active = true;
    void Promise.allSettled([listPoMirror(), listQuoteSuppliers()]).then(([orders, supplierRows]) => {
      if (!active) return;
      if (orders.status === "fulfilled") setMirrors(orders.value.rows);
      if (supplierRows.status === "fulfilled") setSuppliers(supplierRows.value);
      if (orders.status === "rejected" || supplierRows.status === "rejected") setOptionsError(t("部分关联选项加载失败，可关闭后重试；手工登记仍可使用。"));
    });
    return () => { active = false; };
  }, [t]);
  const linked = Boolean(form.purchaseOrderMirrorId);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (savingRef.current) return;
    const purchaseQty = Number(form.purchaseQty);
    if (!linked && !form.supplierName.trim()) {
      toast.error(t("请填写供应商"));
      return;
    }
    if (!linked && (!Number.isFinite(purchaseQty) || purchaseQty <= 0)) {
      toast.error(t("本批采购量必须大于 0"));
      return;
    }
    const input: ProcStockPlanBatchInput = {
      ...(linked ? {purchaseOrderMirrorId: form.purchaseOrderMirrorId} : {
        supplierId: form.supplierId,
        supplierName: form.supplierName.trim(),
        purchaseQty,
        purchaseOrderNo: form.purchaseOrderNo.trim(),
        orderDate: form.orderDate,
        expectedArrivalDate: form.expectedArrivalDate,
        receivedQty: Number(form.receivedQty),
      }),
      qualifiedQty: Number(form.qualifiedQty),
      actualArrivalDate: form.actualArrivalDate,
      note: form.note.trim(),
    };
    savingRef.current = true;
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
      savingRef.current = false;
      setSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => { if (!open && !savingRef.current) onClose(); }}>
      <DialogContent className="proc-horizon-overlay max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
        <form onSubmit={submit} className="grid gap-5">
          <DialogHeader>
            <DialogTitle>{t(batch ? "编辑采购批次" : "添加采购批次")}</DialogTitle>
            <DialogDescription>
              {plan.materialName}，{t("目标")} {quantity(plan.targetQty)} {plan.unit || t("单位")}
              {plan.remainingQty > 0 ? `，${t("还需采购")} ${quantity(plan.remainingQty)}` : `，${t("目标已达成")}`}
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <Field label={t("关联 ERP 采购订单行")}>
                <select className={SELECT_CLASS} value={form.purchaseOrderMirrorId} disabled={Boolean(batch?.purchaseOrderMirrorId)} onChange={(e) => setForm((v) => ({...v, purchaseOrderMirrorId: e.target.value}))}>
                  <option value="">{t("手工登记批次")}</option>
                  {batch?.purchaseOrderMirrorId && !mirrors.some((m) => m.id === batch.purchaseOrderMirrorId) && <option value={batch.purchaseOrderMirrorId}>{batch.purchaseOrderNo} · {batch.supplierName}</option>}
                  {mirrors.map((m) => <option key={m.id} value={m.id}>{m.tpOrderNo} / {m.tpLineNo || "单行"} · {m.inventoryName} · {m.supplierName} · {quantity(m.orderedQty)}</option>)}
                </select>
              </Field>
              {optionsError && <p role="alert" className="mt-1 text-xs text-amber-700">{optionsError}</p>}
              {linked && <p className="mt-2 text-xs text-slate-500">{t("采购数量、到货量、供应商和交期随 ERP 更新；这里仅登记检验合格量和实际到货日。")}</p>}
            </div>
            {!linked && <Field label={t("关联供应商档案")}>
              <select className={SELECT_CLASS} value={form.supplierId} onChange={(e) => setForm((v) => ({...v, supplierId: e.target.value, supplierName: suppliers.find((s) => s.id === e.target.value)?.name || v.supplierName}))}>
                <option value="">{t("手工填写供应商")}</option>
                {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </Field>}
            {!linked && <>
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
            <Field label={t("实际到货量")}>
              <Input type="number" min="0" step="0.001" max={form.purchaseQty || undefined} value={form.receivedQty} onChange={(e) => setForm((v) => ({...v, receivedQty: e.target.value}))} />
            </Field>
            </>}
            <Field label={t("检验合格量")}>
              <Input type="number" min="0" step="0.001" value={form.qualifiedQty} onChange={(e) => setForm((v) => ({...v, qualifiedQty: e.target.value}))} />
            </Field>
            <Field label={t("实际到货日期")}>
              <Input type="date" value={form.actualArrivalDate} onChange={(e) => setForm((v) => ({...v, actualArrivalDate: e.target.value}))} />
            </Field>
            <div className="sm:col-span-2">
              <Field label={t("批次备注")}>
                <Textarea rows={3} value={form.note} onChange={(event) => setForm((current) => ({ ...current, note: event.target.value }))} placeholder={t("记录交期、付款或分批原因")} />
              </Field>
            </div>
          </div>

          <DialogFooter>
            <Button type="button" disabled={saving} variant="outline" onClick={onClose}>{t("取消")}</Button>
            <Button type="submit" disabled={saving} className="bg-[#002fa7] text-white hover:bg-[#002581]">
              {saving ? t("保存中...") : t(batch ? "保存修改" : "添加批次")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function PlanReadiness({ plan, canCreate, onSaved }: {plan: ProcStockPlan; canCreate: boolean; onSaved: (plan: ProcStockPlan) => void}) {
  const navigate = useNavigate();
  const [data, setData] = useState<InventoryReadinessResponse | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [version, setVersion] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setData(null); setError("");
    void getProcStockPlanReadiness(plan.id, controller.signal).then((next) => {
      if (!controller.signal.aborted) setData(next);
    }).catch((cause) => { if (!controller.signal.aborted) setError(cause.message); });
    return () => controller.abort();
  }, [plan.id, plan.updatedAt, version]);
  const generate = async () => {
    setBusy(true);
    try {
      const result = await generateProcStockPlanTasks(plan.id);
      onSaved(result.plan);
      void refreshProcurement();
      toast.success(result.createdCount ? `已生成 ${result.createdCount} 条生产采购任务` : result.existingCount ? `已有 ${result.existingCount} 条关联任务，无需重复生成` : "当前库存与在途已覆盖目标，无需生成采购任务");
    } catch (cause) { toast.error(cause instanceof Error ? cause.message : "生成失败"); }
    finally { setBusy(false); }
  };
  const complete = data && !data.dataQuality.provisional && data.dataQuality.totalBomLines > 0;
  return <div className="mb-4 rounded-lg border border-slate-200 bg-white p-3">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h4 className="text-xs font-semibold text-slate-700">{plan.planType === "machine" ? "整机物料齐套" : "量产库存覆盖"}</h4>
      <div className="flex gap-2">
        {plan.planType === "machine" && <Button size="sm" variant="outline" onClick={() => navigate(`/proc-inventory-readiness?${new URLSearchParams({productLine: plan.productLine || "", targetSets: String(plan.targetQty)})}`)}>查看物料明细</Button>}
        {canCreate && <Button size="sm" disabled={busy || !complete || !plan.productId || Boolean(plan.tasks?.length)} onClick={() => void generate()}>{busy ? "生成中…" : plan.tasks?.length ? "已关联采购任务" : "按缺口生成采购任务"}</Button>}
      </div>
    </div>
    {error ? <p role="alert" className="mt-2 text-xs text-rose-600">{error} <button className="underline" onClick={() => setVersion((v) => v + 1)}>重试</button></p> : !data ? <p className="mt-2 text-xs text-slate-400">核算库存与在途中…</p> : <>
      <div className="mt-3 grid grid-cols-3 gap-2 text-xs text-slate-600">
        <p>当前可用覆盖 <strong className="block text-lg text-slate-900">{quantity(data.summary.currentBuildableSets)} {plan.unit}</strong></p>
        <p>全部在途到货后 <strong className="block text-lg text-[#002fa7]">{quantity(data.summary.withTransitBuildableSets)} {plan.unit}</strong></p>
        <p>目标缺口 <strong className="block text-lg text-rose-600">{quantity(data.summary.targetGapAfterTransit)} {plan.unit}</strong></p>
      </div>
      {!complete && <p className="mt-2 text-xs text-amber-700">BOM 或库存映射不完整，先完善数据再生成采购任务。</p>}
      {!plan.productId && <p className="mt-2 text-xs text-amber-700">请先编辑计划并选择所属产品，再生成采购任务。</p>}
      <p className="mt-2 text-[11px] text-slate-500">量产仓库快照估算，未预占库存，不代表可按计划日期交付；多个计划共享库存需排程确认。最近同步：{data.syncedAt ? new Date(data.syncedAt).toLocaleString("zh-CN") : "无记录"}。</p>
    </>}
    {!!plan.tasks?.length && <div className="mt-3 flex flex-wrap gap-2">{plan.tasks.map((task) => <button key={task.id} className="rounded-md bg-[#eef3ff] px-2 py-1 text-xs text-[#002fa7]" onClick={() => navigate(`/proc-cockpit?line=production&task=${encodeURIComponent(task.id)}`)}>{task.code} · {task.materialName} · {quantity(task.quantity)}</button>)}</div>}
  </div>;
}

function MonthlyPlanOverview({plans, month}: {plans: ProcStockPlan[]; month: string}) {
  const [selectedGroup, setSelectedGroup] = useState("");
  const [readiness, setReadiness] = useState<InventoryReadinessResponse | null>(null);
  const [readinessError, setReadinessError] = useState("");
  const groups = useMemo(() => {
    const byKey = new Map<string, {key: string; label: string; unit: string; plans: ProcStockPlan[]}>();
    for (const plan of plans) {
      const key = [plan.planType, plan.productId, plan.planType === "machine" ? plan.productLine : plan.materialId || `${plan.materialName}/${plan.spec}`, plan.unit].join(":");
      const group = byKey.get(key) || {key, label: `${PLAN_TYPE_LABELS[plan.planType]} · ${plan.materialName} ${plan.productLine || plan.spec} (${plan.unit || "未设单位"})`, unit: plan.unit, plans: []};
      group.plans.push(plan); byKey.set(key, group);
    }
    return [...byKey.values()];
  }, [plans]);
  const group = groups.find((g) => g.key === selectedGroup) || groups[0];
  const anchorId = group?.plans[0]?.id;
  useEffect(() => {
    setReadiness(null); setReadinessError("");
    if (!anchorId || !month) return;
    const controller = new AbortController();
    void getProcStockPlanReadiness(anchorId, controller.signal, month)
      .then((data) => { if (!controller.signal.aborted) setReadiness(data); })
      .catch((cause) => { if (!controller.signal.aborted) setReadinessError(cause.message); });
    return () => controller.abort();
  }, [anchorId, month, plans]);
  if (!group || !month) return null;
  const target = group.plans.reduce((sum, p) => sum + p.targetQty, 0);
  const qualified = group.plans.reduce((sum, p) => sum + Math.min(p.targetQty, p.qualifiedQty), 0);
  const outstanding = Math.max(0, target - qualified);
  const expected = group.plans.reduce((sum, p) => sum + p.batches.filter((b) => b.expectedArrivalDate?.startsWith(month)).reduce((n, b) => n + Math.max(0, b.purchaseQty - b.receivedQty), 0), 0);
  const events = group.plans.flatMap((p) => [
    {id: p.id, date: p.targetDate, text: `${p.materialName} · 目标 ${quantity(p.targetQty)} ${p.unit}`},
    ...p.batches.filter((b) => b.expectedArrivalDate).map((b) => ({id: b.id, date: b.expectedArrivalDate, text: `${b.supplierName} · 预计到货 ${quantity(Math.max(0, b.purchaseQty - b.receivedQty))} ${p.unit}`})),
  ]).filter((e) => e.date?.startsWith(month)).sort((a, b) => (a.date || "").localeCompare(b.date || ""));
  return <section className="rounded-xl border border-slate-200 bg-white p-4">
    <div className="flex flex-wrap items-center justify-between gap-2"><div><h3 className="text-sm font-semibold text-slate-900">{month} 备货目标与交期</h3><p className="mt-1 text-xs text-slate-500">按同产品、同物料或型号、同单位核对；环形图表示本计划已登记合格进度。</p></div><select aria-label="月度统计物料" className={`${SELECT_CLASS} sm:max-w-80`} value={group.key} onChange={(e) => setSelectedGroup(e.target.value)}>{groups.map((g) => <option key={g.key} value={g.key}>{g.label}</option>)}</select></div>
    <div className="mt-3 grid gap-4 md:grid-cols-[170px_1fr_1.2fr]">
      <div className="h-36" role="img" aria-label={`合格 ${quantity(qualified)}，待满足 ${quantity(outstanding)} ${group.unit}`}><ResponsiveContainer width="100%" height="100%"><PieChart><Pie data={[{name: "已登记合格", value: qualified}, {name: "待满足", value: outstanding}]} dataKey="value" innerRadius={40} outerRadius={62} isAnimationActive={false}><Cell fill="#10b981" /><Cell fill="#e2e8f0" /></Pie><Tooltip /></PieChart></ResponsiveContainer></div>
      <dl className="grid grid-cols-2 items-center gap-3 text-xs text-slate-500">{[["目标需求", target], ["已登记合格", qualified], ["登记缺口", outstanding], ["本月预计到货", expected]].map(([label, value]) => <div key={label}><dt>{label}</dt><dd className="mt-1 text-lg font-semibold tabular-nums text-slate-900">{quantity(Number(value))} <span className="text-xs font-normal">{group.unit}</span></dd></div>)}</dl>
      <ol className="max-h-40 space-y-2 overflow-y-auto border-l-2 border-[#e1eaff] pl-4 text-xs">{events.map((event) => <li key={event.id}><time className="font-semibold text-[#002fa7]">{event.date}</time><p className="mt-0.5 text-slate-600">{event.text}</p></li>)}{!events.length && <li className="text-slate-500">本月暂无已登记交期。</li>}</ol>
    </div>
    <div className="mt-3 rounded-lg bg-slate-50 p-3 text-xs text-slate-600">{readinessError ? <span role="alert" className="text-amber-700">月度库存核算：{readinessError}</span> : !readiness ? "正在核算本月合并需求…" : <><strong className="text-slate-900">本月同组库存核算：</strong>当前可用覆盖 {quantity(readiness.summary.currentBuildableSets)}，全部在途到货后覆盖 {quantity(readiness.summary.withTransitBuildableSets)}，<strong className="text-rose-600">合并需求缺口 {quantity(readiness.summary.targetGapAfterTransit)} {group.unit}</strong>{readiness.dataQuality.provisional && <span className="ml-2 text-amber-700">数据不完整，仅供估算</span>}</>}</div>
    <p className="mt-2 text-[11px] text-slate-500">月度核算只使用一次公共库存，不含其它月份的未交付计划，未预留库存；全部在途不保证本月到货。整机库存核算先扣已订购整机套数，再核算 BOM。生产实绩见“生产与质量”。</p>
  </section>;
}

export function StockPlanPanel({ materials, canCreate, productId, treeNodeId }: { materials: Material[]; canCreate: boolean; productId?: string; treeNodeId?: string }) {
  const { t } = useI18n();
  const [params, setParams] = useSearchParams();
  const [planType, setPlanType] = useState<"all" | ProcStockPlanType>("all");
  const [month, setMonth] = useState("");
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
  const sourceMaterial = materials.find((m) => (params.get("materialCode") && (m.tpInventoryCode === params.get("materialCode") || m.erpCode === params.get("materialCode"))) || (params.get("materialId") && m.id === params.get("materialId")));
  const defaults: Partial<ProcStockPlanInput> = {productId: productId || params.get("product") || undefined, treeNodeId,
    planType: params.get("planType") === "machine" ? "machine" : params.get("planType") === "packaging" ? "packaging" : "material",
    productLine: params.get("productLine") || undefined, materialId: sourceMaterial?.id,
    materialName: sourceMaterial?.name || params.get("materialName") || (params.get("productLine") ? `${params.get("productLine")}整机` : undefined),
    spec: sourceMaterial?.spec, unit: sourceMaterial?.unit || params.get("unit") || (params.get("planType") === "machine" ? "套" : undefined),
    targetQty: Number(params.get("targetQty")) || undefined, targetDate: params.get("targetDate") || undefined,
    productionTaskId: params.get("productionTaskId") || undefined, note: params.get("note") || undefined};
  useEffect(() => {
    if (params.get("newPlan") !== "1" || !canCreate) return;
    setEditingPlan("new");
    setParams((current) => { const next = new URLSearchParams(current); next.delete("newPlan"); return next; }, {replace: true});
  }, [params, canCreate, setParams]);

  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setError(null);
    try {
      const next = await listProcStockPlans(signal, {productId, treeNodeId});
      if (!signal?.aborted) setPlans(next);
    } catch (cause) {
      if (!signal?.aborted) setError(cause instanceof Error ? cause.message : t("备货计划加载失败"));
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, [t, productId, treeNodeId]);

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

  const scopedPlans = useMemo(() => plans.filter((plan) => (planType === "all" || plan.planType === planType) && (!month || plan.targetDate?.startsWith(month))), [plans, planType, month]);
  const counts = useMemo(() => ({
    all: scopedPlans.length,
    not_started: scopedPlans.filter((plan) => plan.status === "not_started").length,
    in_progress: scopedPlans.filter((plan) => plan.status === "in_progress").length,
    completed: scopedPlans.filter((plan) => plan.status === "completed").length,
  }), [scopedPlans]);

  const filtered = useMemo(() => {
    const query = keyword.trim().toLocaleLowerCase("zh-CN");
    return scopedPlans.filter((plan) => {
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
  }, [keyword, scopedPlans, status]);

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
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto">
      <section className="proc-horizon-command proc-horizon-command-cockpit">
        <div className="proc-horizon-command-layout">
          <div className="proc-horizon-command-heading">
            <span className="proc-horizon-command-mark"><PackagePlus aria-hidden="true" className="size-5" /></span>
            <div className="proc-horizon-command-copy">
              <h2>{t("备货计划")}</h2>
              <p>{t("按整机、包材和物料管理备货目标，衔接采购、到货、检验及生产实绩。")}</p>
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
              ["not_started", "未下单", CircleDashed],
              ["in_progress", "下单中", Truck],
              ["completed", "下单达标", CheckCircle2],
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

      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-3">
        <div className="flex flex-wrap gap-1" role="group" aria-label="计划类型筛选">{(["all", "machine", "packaging", "material"] as const).map((type) => <button type="button" aria-pressed={planType === type} key={type} onClick={() => setPlanType(type)} className={cn("rounded-lg px-3 py-2 text-xs font-semibold", planType === type ? "bg-[#eef3ff] text-[#002fa7]" : "text-slate-500 hover:bg-slate-50")}>{type === "all" ? "全部类型" : PLAN_TYPE_LABELS[type]}</button>)}</div>
        <label className="ml-auto flex items-center gap-2 text-xs text-slate-500">目标月份<Input type="month" aria-label="目标月份" className="w-40" value={month} onChange={(e) => setMonth(e.target.value)} /></label>
        {month && <Button size="sm" variant="ghost" onClick={() => setMonth("")}>全部月份</Button>}
      </div>
      {!loading && !error && month && <MonthlyPlanOverview month={month} plans={scopedPlans} />}
      <section className="proc-horizon-task-feed flex min-h-[280px] flex-1 flex-col">
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
                <span>{t("目标备货量")}</span>
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
                          <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-500">{PLAN_TYPE_LABELS[plan.planType]}</span>
                        </div>
                        <p className="mt-1 truncate text-xs text-slate-500"><span className="font-medium tabular-nums">{plan.code}</span>{plan.spec ? ` · ${plan.spec}` : ""}</p>
                        {plan.note ? <p className="mt-1 line-clamp-1 text-xs text-slate-500">{plan.note}</p> : null}
                      </div>

                      <div className="text-sm tabular-nums text-slate-700">
                        <span className="mb-1 block text-[10px] font-semibold text-slate-400 lg:hidden">{t("目标备货量")}</span>
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
                        <p className="mt-1 text-[11px] text-slate-600">到货 {quantity(plan.receivedQty)} · 合格 {quantity(plan.qualifiedQty)} {plan.unit}</p>
                        <p className={cn("mt-1 text-[10px]", plan.readinessStatus === "qualified" ? "text-emerald-700" : "text-amber-700")}>{{not_received: "尚未到货", partial_received: "部分到货", pending_inspection: "到货达标，待检验", qualified: "已登记合格达标"}[plan.readinessStatus]}</p>
                        {plan.qualityDataIssue && <p className="text-[10px] text-rose-600">ERP 到货量变更，请复核合格量</p>}
                        {plan.orderDataIssue && <p className="text-[10px] text-rose-600">采购订单异常，请展开复核</p>}
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
                        <PlanReadiness plan={plan} canCreate={canCreate} onSaved={replacePlan} />
                        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                          <p className="text-xs font-semibold text-slate-600">
                            {t("采购批次")} <span className="ml-1 font-normal text-slate-500">{plan.batches.length} {t("批")}，{supplierCount} {t("家供应商")}</span>
                          </p>
                          {canCreate ? <button type="button" onClick={() => setEditingBatch({ plan })} className="inline-flex items-center gap-1 text-xs font-semibold text-[#002fa7] hover:underline"><Plus aria-hidden="true" className="size-3.5" />{t("添加批次")}</button> : null}
                        </div>
                        {plan.batches.length === 0 ? (
                          <div className="rounded-lg border border-dashed border-slate-200 bg-white px-4 py-6 text-center text-xs text-slate-500">
                            {t("尚未登记采购批次，可先核算库存缺口。")}
                          </div>
                        ) : (
                          <div className="grid gap-2">
                            {plan.batches.map((batch, index) => (
                              <div key={batch.id} className="grid gap-3 rounded-lg border border-slate-200 bg-white p-3 md:grid-cols-[minmax(8rem,1fr)_minmax(6rem,.55fr)_minmax(8rem,.8fr)_minmax(10rem,1fr)_auto] md:items-center">
                                <div className="min-w-0">
                                  <p className="text-xs font-semibold text-[#1b2559]">{t("第 {count} 批", { count: index + 1 })} · {batch.supplierName}</p>
                                  <p className="mt-1 text-[11px] text-slate-500">{batch.createdByName || t("未知")}，{batch.createdAt.slice(0, 10)}</p>
                                </div>
                                <div className="text-xs text-slate-600"><span className="mr-1 text-slate-400">{t("采购量")}</span><strong className="tabular-nums text-[#1b2559]">{quantity(batch.purchaseQty)} {plan.unit}</strong><p className="mt-1 text-[11px]">到货 {quantity(batch.receivedQty)} · 合格 {quantity(batch.qualifiedQty)}</p>{batch.qualityDataIssue && <p className="text-[11px] text-rose-600">原登记合格 {quantity(batch.recordedQualifiedQty ?? batch.qualifiedQty)}，请复核</p>}</div>
                                <div className="text-xs text-slate-600"><span className="mr-1 text-slate-400">{t("采购单")}</span>{batch.purchaseOrderNo || t("未填写")}</div>
                                <div className="text-xs text-slate-600">
                                  <p>{t("下单")}：{dateLabel(batch.orderDate)}</p>
                                  <p className="mt-1">{t("预计到货")}：{dateLabel(batch.expectedArrivalDate)}</p>
                                  <p className="mt-1">实际到货：{dateLabel(batch.actualArrivalDate)}{batch.purchaseOrderMirrorId ? " · ERP 关联" : ""}</p>
                                  {batch.note ? <p className="mt-1 text-slate-500">{batch.note}</p> : null}
                                  {batch.orderIssue && <p className="mt-1 text-xs text-rose-600">{batch.orderIssue}</p>}
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
                        {plan.productId && plan.treeNodeId && <div className="mt-4"><SubsystemOperationsPanel productId={plan.productId} treeNodeId={plan.treeNodeId} stockPlanId={plan.id} /></div>}
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
          defaults={editingPlan === "new" ? defaults : undefined}
          onClose={() => {
            setEditingPlan(null);
            setParams((current) => {
              const next = new URLSearchParams(current);
              for (const key of ["newPlan", "planType", "productLine", "productionTaskId", "materialCode", "materialId", "materialName", "targetQty", "targetDate", "unit", "note"]) next.delete(key);
              return next;
            }, {replace: true});
          }}
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
