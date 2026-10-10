import { cloneElement, FormEvent, useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  CalendarClock,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
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
import { useLocation, useNavigate, useSearchParams } from "react-router";
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import { refreshProcurement, useProcurementProducts } from "../data";

import { useI18n } from "../../lib/i18n";
import { usePermission } from "../../hooks/usePermission";
import { StockPlanBomBasis } from "./StockPlanBomBasis";
import { buildPurchaseOrderLinePath } from "../../lib/purchaseOrderLineNavigation";
import { buildStockPlanReturnPath, parseStockPlanViewState, writeStockPlanViewParams, type StockPlanViewState } from "../../lib/stockPlanNavigation";
import {
  createProcStockPlan,
  createProcStockPlanBatch,
  deleteProcStockPlanBatch,
  generateProcStockPlanTasks,
  getProcStockPlanReadiness,
  getInventoryReadiness,
  readBomDeviceOptions,
  type BomDeviceOption,
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
import { Label } from "../../components/ui/label";
import { Pagination, PaginationContent, PaginationEllipsis, PaginationItem } from "../../components/ui/pagination";
import { Textarea } from "../../components/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "../../components/ui/toggle-group";
import { cn } from "../../components/ui/utils";
import { ComboInput } from "./common";
import { StockPlanSelect, StockPlanDateInput, StockPlanMonthInput } from "./StockPlanControls";
import { StockPlanOrderDateCheck } from "./StockPlanOrderDateCheck";
import { ComponentInventoryValue, InventoryTip } from './ComponentInventory';
import { StockPlanExecution } from './StockPlanExecution';

type StatusFilter = "all" | ProcStockPlanStatus;

const STATUS_LABELS: Record<ProcStockPlanStatus, string> = {
  not_started: "未下单",
  in_progress: "下单中",
  completed: "下单达标",
};
const PLAN_TYPE_LABELS: Record<ProcStockPlanType, string> = { machine: "整机", packaging: "包材", material: "物料" };

function partyFilterKey(id?: string, name?: string) {
  return id?.trim() ? `id:${id.trim()}` : name?.trim() ? `name:${name.trim()}` : "";
}

function partyFilterOptions(parties: Array<{ id?: string; name: string }>) {
  const entries = new Map<string, { value: string; label: string; id?: string }>();
  for (const party of parties) {
    const value = partyFilterKey(party.id, party.name);
    if (value) entries.set(value, { value, label: party.name.trim() || party.id!, id: party.id });
  }
  const options = [...entries.values()];
  return options.map((option) => ({ value: option.value, label: options.some((other) => other.value !== option.value && other.label === option.label)
    ? `${option.label} · ${option.id || "名称记录"}` : option.label })).sort((a, b) => a.label.localeCompare(b.label, "zh-CN"));
}

function flattenNodes(nodes: ProcTaskTreeNode[], prefix = ""): Array<{id: string; name: string}> {
  return nodes.flatMap((node) => {
    const name = prefix ? `${prefix} / ${node.name}` : node.name;
    return [{id: node.id, name}, ...flattenNodes(node.children, name)];
  });
}

function quantity(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value)) return '待核对';
  return new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 3 }).format(value);
}

function dateLabel(value?: string) {
  return value || "未设置";
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

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactElement<{ id?: string }> }) {
  const id = useId();
  return (
    <div className="grid min-w-0 gap-1.5">
      <Label htmlFor={id} className="text-xs font-semibold text-slate-600">{label}{required ? <span className="ml-0.5 text-rose-600">*</span> : null}</Label>
      {cloneElement(children, { id })}
    </div>
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
  const [bomDevices, setBomDevices] = useState<BomDeviceOption[]>([]);
  const [contextError, setContextError] = useState("");
  const targetLocked = Boolean(plan?.tasks?.length);
  const locked = plan?.contextLocked ?? targetLocked;
  const materialLocked = plan?.materialLocked ?? (locked || Boolean(plan?.batches.length));
  const [form, setForm] = useState({
    planType: plan?.planType ?? defaults?.planType ?? "material",
    productId: plan?.productId ?? defaults?.productId ?? "",
    treeNodeId: plan?.treeNodeId ?? defaults?.treeNodeId ?? "",
    productLine: plan?.productLine ?? defaults?.productLine ?? "",
    bomRevisionId: plan?.bomRevisionId ?? "",
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
    void readBomDeviceOptions(controller.signal)
      .then((data) => { if (!controller.signal.aborted) setBomDevices(data.devices); })
      .catch((error) => { if (!controller.signal.aborted) setContextError(error.message); });
    return () => controller.abort();
  }, [form.planType]);
  const models = bomDevices.filter(row => row.productRoot.productId === form.productId && row.revisions.length > 0);
  const [saveError, setSaveError] = useState<string | null>(null);
  const openerRef = useRef(typeof document !== "undefined" && document.activeElement instanceof HTMLElement ? document.activeElement : null);
  // 名称可以自由填写；同名的不同档案只能在“关联物料编码”中按 ID 明确选择。
  const materialNameOptions = useMemo(() => [...new Set(materials.map((material) => material.name))], [materials]);

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
    setSaveError(null);
    const targetQty = Number(form.targetQty);
    if (!form.materialName.trim()) {
      setSaveError(t("请填写物料名称"));
      return;
    }
    if (form.planType === "machine" && !form.productLine) {
      setSaveError(t("请选择整机 BOM 型号"));
      return;
    }
    if (!Number.isFinite(targetQty) || targetQty <= 0) {
      setSaveError(t("目标备货量必须大于 0"));
      return;
    }
    if (!plan && form.planType === "machine" && !models.some(model => model.productLine === form.productLine && model.revisions.some(revision => revision.id === form.bomRevisionId))) {
      setSaveError(t("请选择本产品的有效 BOM 发布版本"));
      return;
    }
    const input: ProcStockPlanInput = {
      planType: form.planType,
      productId: form.productId,
      treeNodeId: form.treeNodeId,
      productLine: form.productLine,
      ...(form.bomRevisionId ? { bomRevisionId: form.bomRevisionId } : {}),
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
      setSaveError(cause instanceof Error ? cause.message : t("保存失败"));
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => { if (!open && !savingRef.current) onClose(); }}>
      <DialogContent
        className="proc-horizon-overlay proc-stock-plan-form-dialog max-h-[90dvh] flex flex-col overflow-hidden p-0 sm:max-w-2xl"
        onCloseAutoFocus={(event) => {
          if (openerRef.current?.isConnected) { event.preventDefault(); openerRef.current.focus(); }
        }}
      >
        <form onSubmit={submit} className="flex min-h-0 flex-1 flex-col">
          <DialogHeader className="px-6 pb-4 pt-6 pr-14">
            <DialogTitle>{t(plan ? "编辑备货任务单" : "新建备货任务单")}</DialogTitle>
            <DialogDescription>{t("整机按 BOM 查看物料齐套，包材和物料按本身数量备货。下单、到货与合格进度分别记录。")}</DialogDescription>
          </DialogHeader>
          <div className="proc-stock-plan-form-fields grid min-h-0 gap-4 overflow-y-auto overscroll-contain px-6 pb-6 sm:grid-cols-2">
            {contextError && <p role="alert" className="text-xs text-rose-600 sm:col-span-2">{contextError}</p>}
            {locked && <p className="text-xs text-slate-500 sm:col-span-2">{t(targetLocked ? "已生成采购任务，计划来源和目标量已锁定。" : "已有生产或质量记录，计划归属和物料已锁定。")}</p>}
            {form.productionTaskId && <p className="break-words text-xs text-slate-500 sm:col-span-2">{t("来自生产任务")}：{form.productionTaskId}</p>}
            <Field label={t("计划类型")} required>
              <StockPlanSelect label={t("计划类型")} required disabled={materialLocked || plan?.planType === 'machine'} value={form.planType}
                onValueChange={(value) => setForm((v) => ({...v, planType: value as ProcStockPlanType, unit: value === "machine" ? "套" : v.unit, productLine: ""}))}
                options={Object.entries(PLAN_TYPE_LABELS).map(([value, label]) => ({ value, label: t(label) }))} />
            </Field>
            <Field label={t("所属产品")}>
              <StockPlanSelect label={t("所属产品")} disabled={locked || plan?.planType === 'machine' || Boolean(defaults?.productId)} value={form.productId}
                onValueChange={(value) => setForm((v) => ({...v, productId: value, treeNodeId: "", productLine: "", bomRevisionId: ""}))}
                emptyLabel={t("请选择产品")} options={products.map((p) => ({ value: p.id, label: p.name }))} />
            </Field>
            <Field label={t("所属子系统")}>
              <StockPlanSelect label={t("所属子系统")} disabled={locked || !form.productId || Boolean(defaults?.treeNodeId)} value={form.treeNodeId}
                onValueChange={(value) => setForm((v) => ({...v, treeNodeId: value}))}
                emptyLabel={t("请选择子系统")} options={nodes.map((node) => ({ value: node.id, label: node.name }))} />
            </Field>
            {form.planType === "machine" && <Field label={t("整机 BOM 型号")} required>
              <StockPlanSelect label={t("整机 BOM 型号")} required disabled={materialLocked || Boolean(plan)} value={form.productLine}
                onValueChange={(value) => setForm((v) => ({...v, productLine: value, bomRevisionId: ""}))}
                emptyLabel={t("选择 BOM 型号")} options={plan ? [{ value: plan.productLine || '', label: plan.productLine || '' }] : models.map((m) => ({ value: m.productLine, label: m.productLine }))} />
            </Field>}
            {form.planType === "machine" && !plan && <Field label={t("已发布 BOM 版本")} required><StockPlanSelect label={t("已发布 BOM 版本")} required value={form.bomRevisionId} onValueChange={value => setForm(v => ({ ...v, bomRevisionId: value }))} emptyLabel={t("请先在 BOM 页面发布版本")} options={(models.find(row => row.productLine === form.productLine)?.revisions ?? []).map(row => ({ value: row.id, label: `V${row.version}` }))} /></Field>}
            <Field label={t("物料名称")} required>
              <ComboInput
                value={form.materialName}
                onChange={changeMaterial}
                options={materialNameOptions}
                ariaLabel={t("物料名称")}
                placeholder={t("输入或选择物料")}
                required
                autoFocus
                disabled={materialLocked}
              />
            </Field>
            <Field label={t("关联物料编码")}>
              <StockPlanSelect label={t("关联物料编码")} searchable disabled={materialLocked} value={form.materialId} onValueChange={(value) => {
                const material = materials.find((m) => m.id === value);
                setForm((v) => ({...v, materialId: value, ...(material ? {materialName: material.name, spec: material.spec, unit: v.planType === "machine" ? "套" : material.unit} : {})}));
              }} emptyLabel={t("未关联（单物料生成采购任务前须关联）")}
                options={materials.filter((m) => !form.materialName || m.name.includes(form.materialName) || m.id === form.materialId)
                  .map((m) => ({ value: m.id, label: `${m.tpInventoryCode || m.erpCode || t("未编码")} · ${m.name} · ${m.spec}` }))} />
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
              <StockPlanDateInput label={t("计划完成日期")} disabled={targetLocked} value={form.targetDate} onChange={(value) => setForm((current) => ({ ...current, targetDate: value }))} />
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
  const [saveError, setSaveError] = useState<string | null>(null);
  const openerRef = useRef(typeof document !== "undefined" && document.activeElement instanceof HTMLElement ? document.activeElement : null);

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
    setSaveError(null);
    const purchaseQty = Number(form.purchaseQty);
    if (!linked && !form.supplierName.trim()) {
      setSaveError(t("请填写供应商"));
      return;
    }
    if (!linked && (!Number.isFinite(purchaseQty) || purchaseQty <= 0)) {
      setSaveError(t("本批采购量必须大于 0"));
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
      setSaveError(cause instanceof Error ? cause.message : t("保存失败"));
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => { if (!open && !savingRef.current) onClose(); }}>
      <DialogContent
        className="proc-horizon-overlay proc-stock-plan-form-dialog max-h-[90dvh] flex flex-col overflow-hidden p-0 sm:max-w-2xl"
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
            <div className="sm:col-span-2">
              <Field label={t("关联 ERP 采购订单行")}>
                <StockPlanSelect
                  label={t("关联 ERP 采购订单行")}
                  searchable
                  value={form.purchaseOrderMirrorId}
                  disabled={Boolean(batch?.purchaseOrderMirrorId)}
                  emptyLabel={t("手工登记批次")}
                  onValueChange={(value) => setForm((current) => ({ ...current, purchaseOrderMirrorId: value }))}
                  options={[
                    ...(batch?.purchaseOrderMirrorId && !mirrors.some((mirror) => mirror.id === batch.purchaseOrderMirrorId)
                      ? [{ value: batch.purchaseOrderMirrorId, label: `${batch.purchaseOrderNo} · ${batch.supplierName}` }]
                      : []),
                    ...mirrors.map((mirror) => ({
                      value: mirror.id,
                      label: `${mirror.tpOrderNo} / ${mirror.tpLineNo || "单行"} · ${mirror.inventoryName} · ${mirror.supplierName} · ${quantity(mirror.orderedQty)}`,
                    })),
                  ]}
                />
              </Field>
              {optionsError && <p role="alert" className="mt-1 text-xs text-amber-700">{optionsError}</p>}
              {linked && <p className="mt-2 text-xs text-slate-500">{t("采购数量、到货量、供应商和交期随 ERP 更新；这里仅登记检验合格量和实际到货日。")}</p>}
            </div>
            {!linked && <Field label={t("关联供应商档案")}>
              <StockPlanSelect
                label={t("关联供应商档案")}
                searchable
                value={form.supplierId}
                emptyLabel={t("手工填写供应商")}
                onValueChange={(value) => setForm((current) => ({ ...current, supplierId: value, supplierName: suppliers.find((supplier) => supplier.id === value)?.name || current.supplierName }))}
                options={suppliers.map((supplier) => ({ value: supplier.id, label: supplier.name }))}
              />
            </Field>}
            {!linked && <>
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
              <StockPlanDateInput label={t("下单日期")} value={form.orderDate} onChange={(value) => setForm((current) => ({ ...current, orderDate: value }))} />
            </Field>
            <Field label={t("预计到货日期")}>
              <StockPlanDateInput label={t("预计到货日期")} value={form.expectedArrivalDate} onChange={(value) => setForm((current) => ({ ...current, expectedArrivalDate: value }))} />
            </Field>
            <Field label={t("实际到货量")}>
              <Input type="number" min="0" step="0.001" max={form.purchaseQty || undefined} value={form.receivedQty} onChange={(e) => setForm((v) => ({...v, receivedQty: e.target.value}))} />
            </Field>
            </>}
            <Field label={t("检验合格量")}>
              <Input type="number" min="0" step="0.001" value={form.qualifiedQty} onChange={(e) => setForm((v) => ({...v, qualifiedQty: e.target.value}))} />
            </Field>
            <Field label={t("实际到货日期")}>
              <StockPlanDateInput label={t("实际到货日期")} value={form.actualArrivalDate} onChange={(value) => setForm((current) => ({ ...current, actualArrivalDate: value }))} />
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
        {plan.planType === "machine" && <Button size="sm" variant="outline" onClick={() => navigate(`/proc-inventory-readiness?${new URLSearchParams({productLine: plan.productLine || "", targetSets: String(plan.targetQty), ...(plan.bomRevisionId ? { revisionId: plan.bomRevisionId } : {})})}`)}>查看物料明细</Button>}
        {canCreate && <Button size="sm" disabled={busy || !complete || !plan.productId || Boolean(plan.tasks?.length)} onClick={() => void generate()}>{busy ? "生成中…" : plan.tasks?.length ? "已关联采购任务" : "按缺口生成采购任务"}</Button>}
      </div>
    </div>
    {error ? <p role="alert" className="mt-2 text-xs text-rose-600">{error} <Button type="button" variant="link" size="sm" className="h-auto px-0 py-0 text-xs underline" onClick={() => setVersion((v) => v + 1)}>重试</Button></p> : !data ? <p className="mt-2 text-xs text-muted-foreground">核算库存与在途中…</p> : <>
      <div className="mt-3 grid grid-cols-3 gap-2 text-xs text-slate-600">
        <p>当前可用覆盖 <strong className="block text-lg text-slate-900">{quantity(data.summary.currentBuildableSets)} {plan.unit}</strong></p>
        <p>全部在途到货后 <strong className="block text-lg text-primary">{quantity(data.summary.withTransitBuildableSets)} {plan.unit}</strong></p>
        <p>目标缺口 <strong className="block text-lg text-rose-600">{quantity(data.summary.targetGapAfterTransit)} {plan.unit}</strong></p>
      </div>
      {!complete && <p className="mt-2 text-xs text-amber-700">BOM 或库存映射不完整，先完善数据再生成采购任务。</p>}
      {!plan.productId && <p className="mt-2 text-xs text-amber-700">请先编辑计划并选择所属产品，再生成采购任务。</p>}
      <div className="mt-2 flex flex-wrap gap-x-4">{data.componentStocks?.map(stock => <div key={stock.materialId} className="text-xs text-slate-600"><span className="mr-2">{stock.materialName}</span><ComponentInventoryValue stock={stock} /></div>)}</div>
      <InventoryTip label="查看备货核算口径"><p>需求量＝整机台数 × 单机用量；直接按物料立项时采用填写的需求量。</p><p>建议采购量＝需求量－当前组件可用库存－已登记在途，最低为 0。组件库存包含同范围仓库库存，不再重复相减；人工值替代 ERP 同范围值。</p><p>多个计划共享库存尚未自动预占；在途到货日期需另行核对。未登记或尚未同步的供给不自动计入。</p></InventoryTip>
      <p className="mt-2 text-[11px] text-slate-500">库存快照估算，未预占库存，不代表可按计划日期交付；多个计划共享库存需排程确认。各组件来源及统计时间见库存说明。</p>
    </>}
    {!!plan.tasks?.length && <div className="mt-3 flex flex-wrap gap-2">{plan.tasks.map((task) => <Button type="button" variant="secondary" size="sm" key={task.id} className="h-auto min-w-0 max-w-full justify-start whitespace-normal rounded-md bg-accent px-2 py-1 text-left text-xs text-primary [overflow-wrap:anywhere]" onClick={() => navigate(`/proc-cockpit?line=production&task=${encodeURIComponent(task.id)}`)}>{task.code} · {task.materialName} · {quantity(task.quantity)}</Button>)}</div>}
  </div>;
}

function MonthlyPlanOverview({plans, month}: {plans: ProcStockPlan[]; month: string}) {
  const [selectedGroup, setSelectedGroup] = useState("");
  const [readiness, setReadiness] = useState<InventoryReadinessResponse | null>(null);
  const [readinessError, setReadinessError] = useState("");
  const groups = useMemo(() => {
    const byKey = new Map<string, {key: string; label: string; unit: string; plans: ProcStockPlan[]}>();
    for (const plan of plans) {
      const key = JSON.stringify([plan.planType, plan.productId, plan.planType === "machine" ? [plan.productLine, plan.bomRevisionId ?? null] : plan.materialId || `${plan.materialName}/${plan.spec}`, plan.unit]);
      const basis = plan.planType === 'machine' ? ` · ${plan.bomRevisionId ? `BOM V${plan.bomVersion ?? '?'} · ${plan.code}` : '历史依据待确认'}` : '';
      const group = byKey.get(key) || {key, label: `${PLAN_TYPE_LABELS[plan.planType]} · ${plan.materialName} ${plan.productLine || plan.spec}${basis} (${plan.unit || "未设单位"})`, unit: plan.unit, plans: []};
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
    <div className="flex flex-wrap items-center justify-between gap-2"><div><h3 className="text-sm font-semibold text-slate-900">{month} 备货目标与交期</h3><p className="mt-1 text-xs text-slate-500">按同产品、同物料或型号、同单位核对；环形图表示本计划已登记合格进度。</p></div><StockPlanSelect label="月度统计物料" className="sm:max-w-80" value={group.key} onValueChange={setSelectedGroup} options={groups.map((item) => ({ value: item.key, label: item.label }))} /></div>
    <div className="mt-3 grid gap-4 md:grid-cols-[170px_1fr_1.2fr]">
      <div className="h-36" role="img" aria-label={`合格 ${quantity(qualified)}，待满足 ${quantity(outstanding)} ${group.unit}`}><ResponsiveContainer width="100%" height="100%"><PieChart><Pie data={[{name: "已登记合格", value: qualified}, {name: "待满足", value: outstanding}]} dataKey="value" innerRadius={40} outerRadius={62} isAnimationActive={false}><Cell fill="#10b981" /><Cell fill="#e2e8f0" /></Pie><Tooltip /></PieChart></ResponsiveContainer></div>
      <dl className="grid grid-cols-2 items-center gap-3 text-xs text-slate-500">{[["目标需求", target], ["已登记合格", qualified], ["登记缺口", outstanding], ["本月预计到货", expected]].map(([label, value]) => <div key={label}><dt>{label}</dt><dd className="mt-1 text-lg font-semibold tabular-nums text-slate-900">{quantity(Number(value))} <span className="text-xs font-normal">{group.unit}</span></dd></div>)}</dl>
      <ol className="max-h-40 space-y-2 overflow-y-auto border-l-2 border-[#e1eaff] pl-4 text-xs">{events.map((event) => <li key={event.id}><time className="font-semibold text-primary">{event.date}</time><p className="mt-0.5 text-slate-600">{event.text}</p></li>)}{!events.length && <li className="text-slate-500">本月暂无已登记交期。</li>}</ol>
    </div>
    <div className="mt-3 rounded-lg bg-slate-50 p-3 text-xs text-slate-600">{readinessError ? <span role="alert" className="text-amber-700">月度库存核算：{readinessError}</span> : !readiness ? "正在核算本月合并需求…" : <><strong className="text-slate-900">本月同组库存核算：</strong>当前可用覆盖 {quantity(readiness.summary.currentBuildableSets)}，全部在途到货后覆盖 {quantity(readiness.summary.withTransitBuildableSets)}，<strong className="text-rose-600">合并需求缺口 {quantity(readiness.summary.targetGapAfterTransit)} {group.unit}</strong>{readiness.dataQuality.provisional && <span className="ml-2 text-amber-700">数据不完整，仅供估算</span>}</>}</div>
    <p className="mt-2 text-[11px] text-slate-500">月度核算只使用一次公共库存，不含其它月份的未交付计划，未预留库存；全部在途不保证本月到货。整机库存核算先扣已订购整机套数，再核算 BOM。生产实绩见“生产与质量”。</p>
  </section>;
}

export function StockPlanPanel({ materials, canCreate, productId, treeNodeId, defaultMaterialId }: { materials: Material[]; canCreate: boolean; productId?: string; treeNodeId?: string; defaultMaterialId?: string }) {
  const { t } = useI18n();
  const navigate = useNavigate();
  const location = useLocation();
  const canOpenOrder = usePermission("page:purchase-order-detail");
  const canOpenCockpit = usePermission("page:proc-cockpit");
  const [params, setParams] = useSearchParams();
  const view = useMemo(() => parseStockPlanViewState(params), [params]);
  const { planType, month, keyword, creator, page, pageSize, focusId } = view;
  const status = treeNodeId ? 'all' : view.status;
  const supplier = treeNodeId ? '' : view.supplier;
  const [moreFilters, setMoreFilters] = useState(false);
  const expanded = useMemo(() => new Set(view.expanded), [view.expanded]);
  const updateView = (update: Partial<StockPlanViewState> | ((current: StockPlanViewState) => StockPlanViewState)) => {
    setParams((current) => {
      const previous = parseStockPlanViewState(current);
      return writeStockPlanViewParams(new URLSearchParams(current), typeof update === "function" ? update(previous) : { ...previous, ...update });
    }, { replace: true, state: location.state });
  };
  const setPlanType = (value: StockPlanViewState["planType"]) => updateView({ planType: value, page: 1, focusId: undefined });
  const setMonth = (value: string) => updateView({ month: value, page: 1, focusId: undefined });
  const setExpanded = (update: (current: Set<string>) => Set<string>) => updateView((current) => {
    const next = update(new Set(current.expanded));
    return { ...current, expanded: [...next], focusId: current.focusId && next.has(current.focusId) ? current.focusId : undefined };
  });
  const scopeKey = JSON.stringify([productId ?? null, treeNodeId ?? null]);
  const [loadedPlans, setPlans] = useState<ProcStockPlan[]>([]);
  const [planRevisions, setPlanRevisions] = useState<Record<string, number>>({});
  const [resolvedScope, setResolvedScope] = useState("");
  const [requestLoading, setLoading] = useState(true);
  const loading = requestLoading || resolvedScope !== scopeKey;
  const plans = resolvedScope === scopeKey ? loadedPlans : [];
  const loadRequestRef = useRef(0);
  const [error, setError] = useState<string | null>(null);
  const [editingPlan, setEditingPlan] = useState<ProcStockPlan | "new" | null>(null);
  const [editingBatch, setEditingBatch] = useState<{ plan: ProcStockPlan; batch?: ProcStockPlanBatch } | null>(null);
  const [deletingBatch, setDeletingBatch] = useState<{ plan: ProcStockPlan; batch: ProcStockPlanBatch } | null>(null);
  const [deleting, setDeleting] = useState(false);
  const sourceMaterial = materials.find((m) => (params.get("materialCode") && (m.tpInventoryCode === params.get("materialCode") || m.erpCode === params.get("materialCode"))) || m.id === (params.get("materialId") || defaultMaterialId));
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
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const deleteOpenerRef = useRef<HTMLButtonElement | null>(null);
  const focusedPlanNavigation = useRef<string | null>(null);

  const changeKeyword = (value: string) => {
    updateView({ keyword: value, page: 1, focusId: undefined });
    if (listRef.current) listRef.current.scrollTop = 0;
  };
  const changeStatus = (value: StatusFilter) => {
    updateView({ status: value, page: 1, focusId: undefined });
    if (listRef.current) listRef.current.scrollTop = 0;
  };
  const clearFilters = () => {
    updateView({ planType: "all", month: "", keyword: "", status: "all", supplier: "", creator: "", page: 1, focusId: undefined });
    if (listRef.current) listRef.current.scrollTop = 0;
  };

  const load = useCallback(async (signal?: AbortSignal) => {
    const requestId = ++loadRequestRef.current;
    setLoading(true);
    setError(null);
    try {
      const next = await listProcStockPlans(signal, {productId, treeNodeId});
      if (!signal?.aborted && requestId === loadRequestRef.current) { setPlans(next); setResolvedScope(scopeKey); }
    } catch (cause) {
      if (!signal?.aborted && requestId === loadRequestRef.current) { setError(cause instanceof Error ? cause.message : t("备货计划加载失败")); setResolvedScope(scopeKey); }
    } finally {
      if (!signal?.aborted && requestId === loadRequestRef.current) setLoading(false);
    }
  }, [t, productId, treeNodeId, scopeKey]);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => { controller.abort(); loadRequestRef.current += 1; };
  }, [load]);

  const replacePlan = (saved: ProcStockPlan) => {
    setPlans((current) => {
      const exists = current.some((plan) => plan.id === saved.id);
      return exists ? current.map((plan) => plan.id === saved.id ? saved : plan) : [saved, ...current];
    });
    // Batch changes do not always touch the parent updatedAt. Every confirmed
    // save must refresh this plan's order/date associations independently.
    setPlanRevisions((current) => ({ ...current, [saved.id]: (current[saved.id] ?? 0) + 1 }));
    if (saved.batches.length > 0) {
      setExpanded((current) => new Set(current).add(saved.id));
    }
  };

  const supplierOptions = useMemo(() => partyFilterOptions(plans.flatMap((plan) => plan.batches.map((batch) => ({ id: batch.supplierId, name: batch.supplierName })))), [plans]);
  const creatorOptions = useMemo(() => partyFilterOptions(plans.map((plan) => ({ id: plan.createdBy, name: plan.createdByName }))), [plans]);
  const scopedPlans = useMemo(() => plans.filter((plan) => (planType === "all" || plan.planType === planType)
    && (!month || plan.targetDate?.startsWith(month))
    && (!supplier || plan.batches.some((batch) => partyFilterKey(batch.supplierId, batch.supplierName) === supplier))
    && (!creator || partyFilterKey(plan.createdBy, plan.createdByName) === creator)), [plans, planType, month, supplier, creator]);
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

  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  const currentPage = Math.min(page, pageCount);
  const visiblePlans = filtered.slice((currentPage - 1) * pageSize, currentPage * pageSize);
  const pageNumbers = [...new Set([1, ...Array.from({ length: Math.min(5, pageCount) }, (_, index) => Math.max(1, Math.min(currentPage - 2, pageCount - 4)) + index), pageCount])];
  const hasActiveFilters = planType !== "all" || Boolean(month || keyword.trim() || status !== "all" || supplier || creator);
  const paginationDisabled = loading || Boolean(error || editingPlan || editingBatch || deletingBatch);
  const changePage = (nextPage: number) => {
    if (!paginationDisabled) updateView({ page: Math.max(1, Math.min(nextPage, pageCount)), focusId: undefined });
  };
  useEffect(() => {
    if (!loading && !error && page > pageCount) updateView({ page: pageCount });
  }, [loading, error, page, pageCount]);
  useEffect(() => {
    if (listRef.current) listRef.current.scrollTop = 0;
  }, [currentPage, pageSize, planType, month, keyword, status, supplier, creator]);

  const navigationSnapshot = useRef({ scopeKey, loading, error, visiblePlans, expanded, view, canOpenOrder, canOpenCockpit, productId, treeNodeId });
  navigationSnapshot.current = { scopeKey, loading, error, visiblePlans, expanded, view, canOpenOrder, canOpenCockpit, productId, treeNodeId };
  const openPlanOrderLine = (planId: string, expectedScope: string, orderNo: string, lineId: string) => {
    const current = navigationSnapshot.current;
    if (current.scopeKey !== expectedScope || current.loading || current.error || !current.canOpenOrder || !current.canOpenCockpit
      || !current.expanded.has(planId) || !current.visiblePlans.some((plan) => plan.id === planId)) return;
    const destination = buildPurchaseOrderLinePath(orderNo, lineId);
    const returnPath = buildStockPlanReturnPath({ ...current.view, focusId: planId }, { productId: current.productId, treeNodeId: current.treeNodeId });
    if (!destination || !returnPath) return;
    navigate(returnPath, { replace: true });
    navigate(destination, { state: { stockPlanReturnTo: returnPath, stockPlanHistoryBack: true } });
  };
  const focusedPlan = focusId ? plans.find((plan) => plan.id === focusId) : null;
  const focusOutsideFilters = Boolean(focusedPlan && !filtered.some((plan) => plan.id === focusedPlan.id));
  useEffect(function restoreStockPlanFocus() {
    if (!focusId || loading || error || !focusedPlan || focusOutsideFilters || !expanded.has(focusId)) return;
    const key = JSON.stringify([location.key, scopeKey, focusId]);
    if (focusedPlanNavigation.current === key) return;
    const focusPage = Math.floor(filtered.findIndex((plan) => plan.id === focusId) / pageSize) + 1;
    if (focusPage !== currentPage) {
      updateView({ page: focusPage });
      return;
    }
    const article = Array.from(panelRef.current?.querySelectorAll<HTMLElement>('[data-stock-plan-id]') ?? [])
      .find((element) => element.dataset.stockPlanId === focusId);
    if (!article?.isConnected) return;
    focusedPlanNavigation.current = key;
    article.scrollIntoView({ behavior: 'auto', block: 'nearest' });
    const active = document.activeElement;
    if (active === document.body || active === document.documentElement || !active?.isConnected) article.focus({ preventScroll: true });
  }, [location.key, scopeKey, focusId, loading, error, focusedPlan, focusOutsideFilters, expanded, currentPage, pageSize, filtered]);

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
    <div ref={panelRef} tabIndex={-1} className={cn("proc-stock-plan-panel flex min-h-0 min-w-0 flex-1 flex-col gap-3 overflow-hidden", treeNodeId && "max-sm:overflow-y-auto!")}>
      <section className="proc-horizon-command proc-horizon-command-cockpit shrink-0">
        <div className="proc-horizon-command-layout">
          <div className="proc-horizon-command-heading">
            <span className="proc-horizon-command-mark"><PackagePlus aria-hidden="true" className="size-5" /></span>
            <div className="proc-horizon-command-copy">
              <h2>{t(treeNodeId ? "日常备货批量物料" : "备货计划")}</h2>
              <p>{t(treeNodeId ? "备货计划 → 下单 → 在途 → 到货。支持小批量独立建单，签收数量计入到货。" : "按整机、包材和物料管理备货目标，衔接采购、到货、检验及生产实绩。")}</p>
            </div>
          </div>
          <div className="proc-horizon-actions">
            <div className="proc-horizon-search">
              <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input aria-label={t("搜索备货计划")} value={keyword} onChange={(event) => changeKeyword(event.target.value)} placeholder={t("计划编号 / 物料 / 供应商")} className="pl-8 pr-8 text-xs" />
              {keyword ? (
                <Button type="button" variant="ghost" size="icon" aria-label={t("清空搜索")} onClick={() => changeKeyword("")} className="absolute right-2 top-1/2 size-7 -translate-y-1/2 rounded-md p-0 text-muted-foreground hover:bg-slate-100 hover:text-slate-700">
                  <X aria-hidden="true" className="size-3.5" />
                </Button>
              ) : null}
            </div>
            {canCreate ? (
              <Button type="button" onClick={() => setEditingPlan("new")} className="proc-horizon-primary-action gap-1.5 text-xs">
                <Plus aria-hidden="true" className="size-4" />{t("新建备货任务单")}
              </Button>
            ) : null}
          </div>

          <div hidden={Boolean(treeNodeId)} role="group" aria-label={t("计划状态筛选")} className={treeNodeId ? "hidden" : "proc-horizon-kpi-grid proc-stock-plan-kpi-grid"}>
            {([
              ["all", "全部计划", PackagePlus],
              ["not_started", "未下单", CircleDashed],
              ["in_progress", "下单中", Truck],
              ["completed", "下单达标", CheckCircle2],
            ] as const).map(([key, label, Icon]) => (
              <Button
                key={key}
                type="button"
                variant="ghost"
                data-active={status === key}
                aria-pressed={status === key}
                className="proc-horizon-kpi h-auto min-w-0 flex-col items-start gap-1 whitespace-normal text-left"
                onClick={() => changeStatus(key)}
              >
                <span className="proc-horizon-kpi-icon inline-flex items-center justify-center"><Icon aria-hidden="true" className="size-4" /></span>
                <span className="proc-horizon-kpi-value block tabular-nums">{loading ? "—" : counts[key]}</span>
                <span className="proc-horizon-kpi-label block">{t(label)}</span>
              </Button>
            ))}
          </div>
        </div>
      </section>

      <div className="proc-stock-plan-filters flex shrink-0 flex-wrap items-center gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3" role="group" aria-label={t("备货计划筛选")}>
        <ToggleGroup
          type="single"
          size="sm"
          value={planType}
          onValueChange={(value) => {
            if (value === "all" || value === "machine" || value === "packaging" || value === "material") setPlanType(value);
          }}
          className="max-w-full flex-wrap gap-1"
          aria-label={t("计划类型筛选")}
        >
          {(["all", "machine", "packaging", "material"] as const).map((type) => (
            <ToggleGroupItem value={type} key={type} className="flex-none rounded-lg px-3 text-xs font-semibold data-[state=on]:text-primary">
              {type === "all" ? t("全部类型") : t(PLAN_TYPE_LABELS[type])}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
        <Button type="button" variant="ghost" size="sm" className={treeNodeId ? "ml-auto" : "hidden"} aria-expanded={moreFilters} onClick={() => setMoreFilters(value => !value)}>更多筛选</Button>
        <div className={cn("proc-stock-plan-filter-fields ml-auto min-w-0 flex-wrap items-center gap-3", treeNodeId && !moreFilters ? "hidden!" : "flex")}>
          <div className={treeNodeId ? "hidden" : "proc-stock-plan-filter-field flex items-center gap-2"}>
            <Label htmlFor="stock-plan-status" className="shrink-0 text-xs text-slate-500">{t("计划状态")}</Label>
            <StockPlanSelect id="stock-plan-status" label={t("计划状态")} className="w-32 text-xs" value={status} onValueChange={(value) => changeStatus(value as StatusFilter)} options={[{ value: "all", label: t("全部状态") }, ...Object.entries(STATUS_LABELS).map(([value, label]) => ({ value, label: t(label) }))]} />
          </div>
          <div className={treeNodeId ? "hidden" : "proc-stock-plan-filter-field flex items-center gap-2"}>
            <Label htmlFor="stock-plan-supplier" className="shrink-0 text-xs text-slate-500">{t("供应商")}</Label>
            <StockPlanSelect id="stock-plan-supplier" label={t("供应商")} searchable className="w-44 text-xs" value={supplier} emptyLabel={t("全部供应商")} onValueChange={(value) => updateView({ supplier: value, page: 1, focusId: undefined })}
              options={supplier && !supplierOptions.some((option) => option.value === supplier) ? [{ value: supplier, label: t("已选供应商（当前无记录）") }, ...supplierOptions] : supplierOptions} />
          </div>
          <div className="proc-stock-plan-filter-field flex items-center gap-2">
            <Label htmlFor="stock-plan-creator" className="shrink-0 text-xs text-slate-500">{t("创建人")}</Label>
            <StockPlanSelect id="stock-plan-creator" label={t("创建人")} searchable className="w-36 text-xs" value={creator} emptyLabel={t("全部创建人")} onValueChange={(value) => updateView({ creator: value, page: 1, focusId: undefined })}
              options={creator && !creatorOptions.some((option) => option.value === creator) ? [{ value: creator, label: t("已选创建人（当前无记录）") }, ...creatorOptions] : creatorOptions} />
          </div>
          <div className="proc-stock-plan-filter-field flex items-center gap-2">
            <Label htmlFor="stock-plan-month" className="shrink-0 text-xs text-slate-500">{t("目标月份")}</Label>
            <StockPlanMonthInput id="stock-plan-month" label={t("目标月份")} className="w-40 text-xs" value={month} onChange={setMonth} />
          </div>
          <Button size="sm" variant="ghost" disabled={!hasActiveFilters} onClick={clearFilters} className="text-xs">{t("重置筛选")}</Button>
        </div>
      </div>
      <section className={cn("proc-horizon-task-feed flex min-h-0 flex-1 flex-col", treeNodeId && "max-sm:min-h-[60dvh]! max-sm:shrink-0!")}>
        <div className="proc-horizon-filter-bar">
          <span className="font-semibold text-slate-600">
            {status === "all" ? t("全部备货计划") : t(STATUS_LABELS[status])}
          </span>
          <div className="flex flex-wrap items-center gap-3">
            {hasActiveFilters ? <Button type="button" variant="link" size="sm" onClick={clearFilters} className="h-auto px-0 py-0 text-xs font-semibold">{t("清除筛选")}</Button> : null}
            <span aria-live="polite" className="font-semibold tabular-nums text-slate-500">{loading ? t("正在加载备货计划") : t("显示 {count} 个计划", { count: filtered.length })}</span>
          </div>
        </div>

        <div ref={listRef} className="proc-stock-plan-scroll cockpit-scroll min-h-0 flex-1 overflow-y-auto overscroll-contain bg-background" role="region" aria-label={t("备货计划列表")} tabIndex={0}>
          {!loading && !error && month && <div className="mb-3"><MonthlyPlanOverview month={month} plans={scopedPlans} /></div>}
          {!loading && !error && focusId && (!focusedPlan || focusOutsideFilters) ? <p role="status" className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">{t(focusedPlan ? "原备货计划已不在当前筛选范围内，请调整筛选后核对。" : "原备货计划不存在或已不在当前产品、模块范围内。")}</p> : null}
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
              <PackagePlus aria-hidden="true" className="size-8 text-muted-foreground" />
              <div>
                <p className="text-balance text-sm font-semibold text-slate-700">{t(plans.length ? "没有符合条件的备货计划" : "当前还没有备货计划")}</p>
                <p className="mt-1 text-pretty text-xs text-slate-500">{t(plans.length ? "可切换状态或修改搜索条件" : "创建总计划后，再逐批登记供应商和采购数量")}</p>
              </div>
              {canCreate && plans.length === 0 ? <Button type="button" size="sm" onClick={() => setEditingPlan("new")} className="bg-primary text-white hover:bg-primary-hover">{t("新建备货任务单")}</Button> : null}
              {plans.length > 0 ? <Button type="button" variant="outline" size="sm" onClick={clearFilters}>{t("清除筛选")}</Button> : null}
            </div>
          ) : (
            <div className="proc-stock-plan-list bg-white">
              <div className="proc-stock-plan-table-header sticky top-0 z-10 hidden items-center gap-3 border-b border-slate-200 bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-500" aria-hidden="true">
                <span />
                <span>{t("计划 / 物料")}</span>
                <span>{t("目标备货量")}</span>
                <span>{t("采购进度")}</span>
                <span>{t("计划日期")}</span>
                <span>{t("创建人")}</span>
                <span className="text-right">{t("操作")}</span>
              </div>

              {visiblePlans.map((plan) => {
                const isExpanded = expanded.has(plan.id);
                const overQty = Math.max(plan.purchasedQty - plan.targetQty, 0);
                const supplierCount = new Set(plan.batches.map((batch) => partyFilterKey(batch.supplierId, batch.supplierName)).filter(Boolean)).size;
                return (
                  <article key={plan.id} data-stock-plan-id={plan.id} tabIndex={plan.id === focusId ? -1 : undefined} aria-current={plan.id === focusId ? 'true' : undefined} aria-label={`${plan.code} · ${plan.materialName}`} className="proc-stock-plan-item border-b border-slate-100 last:border-b-0 focus:outline-none focus:ring-2 focus:ring-inset focus:ring-primary">
                    <div className="proc-stock-plan-row grid min-w-0 items-center gap-3 px-3 py-3">
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        aria-label={`${t(isExpanded ? "收起采购批次" : "展开采购批次")} · ${plan.materialName}`}
                        aria-controls={`proc-stock-plan-batches-${plan.id}`}
                        aria-expanded={isExpanded}
                        onClick={() => setExpanded((current) => {
                          const next = new Set(current);
                          if (next.has(plan.id)) next.delete(plan.id); else next.add(plan.id);
                          return next;
                        })}
                        className="proc-stock-plan-toggle size-9 rounded-md p-0 text-slate-500 hover:bg-accent hover:text-primary"
                      >
                        {isExpanded ? <ChevronDown aria-hidden="true" className="size-4" /> : <ChevronRight aria-hidden="true" className="size-4" />}
                      </Button>

                      <div className="proc-stock-plan-material min-w-0">
                        <div className="flex min-w-0 flex-wrap items-center gap-2">
                          <strong title={plan.materialName} className="min-w-0 break-words text-balance text-sm text-foreground">{plan.materialName}</strong>
                          {plan.treeNodeId && plan.tasks.length ? <span className="rounded bg-accent px-1.5 py-0.5 text-xs text-primary">已关联 {plan.tasks.length} 条采购任务</span> : plan.fulfillmentSummary ? <span className="rounded bg-blue-50 px-1.5 py-0.5 text-[10px] font-semibold text-blue-800">{plan.fulfillmentSummary.orderedQty === null ? t('履约待核对') : plan.fulfillmentSummary.remainingToPurchaseQty === 0 ? t('净订购已覆盖') : t('净订购未覆盖')}</span> : <PlanStatus status={plan.status} />}
                          <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-500">{PLAN_TYPE_LABELS[plan.planType]}</span>
                        </div>
                        <p title={`${plan.code}${plan.spec ? ` · ${plan.spec}` : ""}`} className="mt-1 break-words text-xs text-slate-500"><span className="font-medium tabular-nums">{plan.code}</span>{plan.spec ? ` · ${plan.spec}` : ""}</p>
                        {plan.note ? <p title={plan.note} className="mt-1 line-clamp-2 break-words text-pretty text-xs text-slate-500">{plan.note}</p> : null}
                      </div>

                      <div className="proc-stock-plan-target min-w-0 break-words text-sm tabular-nums text-slate-700">
                        <span className="proc-stock-plan-field-label mb-1 block text-xs font-medium text-slate-500">{t("目标备货量")}</span>
                        <strong className="text-foreground">{quantity(plan.targetQty)}</strong> <span className="text-xs text-slate-500">{plan.unit}</span>
                      </div>

                      <div className="proc-stock-plan-progress min-w-0">
                        {plan.treeNodeId && plan.tasks.length ? <p className="text-xs text-muted-foreground">按物料跟进采购与签收<br />展开查看执行明细</p> : <>
                        <span className="proc-stock-plan-field-label mb-1 block text-xs font-medium text-slate-500">{t(plan.fulfillmentSummary ? "ERP / 历史采购原值" : "采购进度")}</span>
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
                        <p className="mt-1 text-[11px] text-slate-600">{plan.fulfillmentSummary ? t('原记录：') : ''}到货 {quantity(plan.receivedQty)} · 合格 {quantity(plan.qualifiedQty)} {plan.unit}</p>
                        {plan.fulfillmentSummary ? <div className="mt-2 rounded border border-blue-100 bg-blue-50 p-2 text-[11px] text-slate-700">
                          <p className="font-semibold">{t('履约台账重算')}</p>
                          <p>{t('仍需采购')} {plan.fulfillmentSummary.remainingToPurchaseQty === null ? t('待核对') : quantity(plan.fulfillmentSummary.remainingToPurchaseQty)} · {t('仍需到货')} {plan.fulfillmentSummary.remainingToReceiveQty === null ? t('待核对') : quantity(plan.fulfillmentSummary.remainingToReceiveQty)}</p>
                          <p>{t('检验可用')} {plan.fulfillmentSummary.qualifiedQty === null ? t('待核对') : quantity(plan.fulfillmentSummary.qualifiedQty)} {plan.unit}</p>
                          {plan.fulfillmentSummary.issues.map((issue) => <p className="mt-1 text-amber-800" key={issue}>{t(issue)}</p>)}
                        </div> : null}
                        <p className={cn("mt-1 text-[10px]", plan.readinessStatus === "qualified" ? "text-emerald-700" : "text-amber-700")}>{{not_received: "尚未到货", partial_received: "部分到货", pending_inspection: "到货达标，待检验", qualified: "已登记合格达标"}[plan.readinessStatus]}</p>
                        {plan.qualityDataIssue && <p className="text-[10px] text-rose-600">ERP 到货量变更，请复核合格量</p>}
                        {plan.orderDataIssue && <p className="text-[10px] text-rose-600">采购订单异常，请展开复核</p>}
                        </>}
                      </div>

                      <div className="proc-stock-plan-date min-w-0 break-words text-xs text-slate-600">
                        <span className="proc-stock-plan-field-label mb-1 block text-xs font-medium text-slate-500">{t("计划日期")}</span>
                        <span className="inline-flex flex-wrap items-center gap-1 tabular-nums"><CalendarClock aria-hidden="true" className="size-3.5 text-muted-foreground" />{plan.targetDate || t("未设置")}</span>
                      </div>

                      <div className="proc-stock-plan-creator min-w-0 break-words text-xs text-slate-600">
                        <span className="proc-stock-plan-field-label mb-1 block text-xs font-medium text-slate-500">{t("创建人")}</span>
                        <p className="font-medium">{plan.createdByName || t("未知")}</p>
                        <p className="mt-0.5 tabular-nums text-xs text-slate-500">{plan.createdAt.slice(0, 10)}</p>
                      </div>

                      <div className="proc-stock-plan-row-actions flex flex-wrap items-center justify-end gap-1">
                        {canCreate ? (
                          <>
                            <Button type="button" variant="ghost" size="sm" onClick={() => setEditingPlan(plan)} className="gap-1 rounded-md px-2 text-xs font-medium text-slate-600 hover:bg-slate-100 hover:text-primary" aria-label={t("编辑总计划")}>
                              <Pencil aria-hidden="true" className="size-3.5" /><span>{t("编辑")}</span>
                            </Button>
                            <Button type="button" variant="secondary" size="sm" onClick={() => setEditingBatch({ plan })} className="gap-1 rounded-md bg-accent px-2 text-xs font-semibold text-primary hover:bg-primary/10" aria-label={t("添加采购批次")}>
                              <Plus aria-hidden="true" className="size-3.5" />{t("加批次")}
                            </Button>
                          </>
                        ) : null}
                      </div>
                    </div>

                    {isExpanded ? (
                      <div id={`proc-stock-plan-batches-${plan.id}`} className="proc-stock-plan-batches min-w-0 border-t border-slate-100 bg-slate-50/70 px-3 py-3">
                        <StockPlanBomBasis plan={plan} canCreate={canCreate} onSaved={() => void load()} />
                        {plan.treeNodeId && <StockPlanExecution plan={plan} />}
                        <PlanReadiness plan={plan} canCreate={canCreate && (plan.planType !== 'machine' || Boolean(plan.bomRevisionId))} onSaved={replacePlan} />
                        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                          <p className="text-xs font-semibold text-slate-600">
                            {t("采购批次")} <span className="ml-1 font-normal text-slate-500">{plan.batches.length} {t("批")}，{supplierCount} {t("家供应商")}</span>
                          </p>
                          {canCreate ? <Button type="button" variant="link" size="sm" onClick={() => setEditingBatch({ plan })} className="gap-1 px-0 text-xs font-semibold"><Plus aria-hidden="true" className="size-3.5" />{t("添加批次")}</Button> : null}
                        </div>
                        {plan.batches.length === 0 ? (
                          <div className="rounded-lg border border-dashed border-slate-200 bg-white px-4 py-6 text-center text-xs text-slate-500">
                            {t("尚未登记采购批次，可先核算库存缺口。")}
                          </div>
                        ) : (
                          <div className="grid gap-2">
                            {plan.batches.map((batch, index) => (
                              <div key={batch.id} className="proc-stock-plan-batch-row grid min-w-0 gap-3 rounded-lg border border-slate-200 bg-white p-3">
                                <div className="min-w-0">
                                  <p title={batch.supplierName} className="break-words text-pretty text-xs font-semibold text-foreground">{t("第 {count} 批", { count: index + 1 })} · {batch.supplierName}</p>
                                  <p className="mt-1 break-words text-xs text-slate-500">{batch.createdByName || t("未知")}，{batch.createdAt.slice(0, 10)}</p>
                                </div>
                                <div className="text-xs text-slate-600"><span className="mr-1 text-muted-foreground">{t("采购量")}</span><strong className="tabular-nums text-foreground">{quantity(batch.purchaseQty)} {plan.unit}</strong><p className="mt-1 text-[11px]">到货 {quantity(batch.receivedQty)} · 合格 {quantity(batch.qualifiedQty)}</p>{batch.qualityDataIssue && <p className="text-[11px] text-rose-600">原登记合格 {quantity(batch.recordedQualifiedQty ?? batch.qualifiedQty)}，请复核</p>}</div>
                                <div className="min-w-0 break-words text-xs text-slate-600"><span className="mr-1 text-muted-foreground">{t("采购单")}</span>{batch.purchaseOrderNo || t("未填写")}</div>
                                <div className="proc-stock-plan-batch-dates min-w-0 break-words text-xs text-slate-600">
                                  <p>{t("下单")}：{dateLabel(batch.orderDate)}</p>
                                  <p className="mt-1">{t("预计到货")}：{dateLabel(batch.expectedArrivalDate)}</p>
                                  <p className="mt-1">实际到货：{dateLabel(batch.actualArrivalDate)}{batch.purchaseOrderMirrorId ? " · ERP 关联" : ""}</p>
                                  {batch.note ? <p className="mt-1 text-slate-500">{batch.note}</p> : null}
                                  {batch.orderIssue && <p className="mt-1 text-xs text-rose-600">{batch.orderIssue}</p>}
                                </div>
                                {canCreate ? (
                                  <div className="proc-stock-plan-batch-actions flex justify-end gap-1">
                                    <Button type="button" variant="ghost" size="icon" onClick={() => setEditingBatch({ plan, batch })} className="size-8 rounded-md p-0 text-slate-500 hover:bg-accent hover:text-primary" aria-label={t("编辑采购批次")}><Pencil aria-hidden="true" className="size-3.5" /></Button>
                                    <Button type="button" variant="ghost" size="icon" onClick={(event) => { deleteOpenerRef.current = event.currentTarget; setDeleteError(null); setDeletingBatch({ plan, batch }); }} className="size-8 rounded-md p-0 text-slate-500 hover:bg-rose-50 hover:text-rose-700" aria-label={t("删除采购批次")}><Trash2 aria-hidden="true" className="size-3.5" /></Button>
                                  </div>
                                ) : null}
                              </div>
                            ))}
                          </div>
                        )}
                        <StockPlanOrderDateCheck key={`${scopeKey}:${plan.id}:${plan.updatedAt}:${planRevisions[plan.id] ?? 0}`} planId={plan.id} onOpenOrderLine={(orderNo, lineId) => openPlanOrderLine(plan.id, scopeKey, orderNo, lineId)} />
                        {plan.productId && plan.treeNodeId && <div className="mt-4"><SubsystemOperationsPanel productId={plan.productId} treeNodeId={plan.treeNodeId} stockPlanId={plan.id} /></div>}
                      </div>
                    ) : null}
                  </article>
                );
              })}
            </div>
          )}
        </div>
        {!error && <div className="proc-horizon-task-pagination">
          <span role="status" aria-live="polite" className="shrink-0 text-xs tabular-nums text-muted-foreground">{loading ? t("正在加载备货计划") : filtered.length === 0 ? t("共 0 个计划") : t("第 {start}–{end} 条，共 {total} 个计划", { start: (currentPage - 1) * pageSize + 1, end: Math.min(currentPage * pageSize, filtered.length), total: filtered.length })}</span>
          <div className="ml-auto flex flex-wrap items-center justify-end gap-3">
            <StockPlanSelect label={t("每页条数")} value={String(pageSize)} disabled={paginationDisabled} className="h-8 w-28 text-xs" onValueChange={(value) => {
              const size = Number(value);
              if (!paginationDisabled && [10, 20, 50].includes(size)) updateView({ pageSize: size, page: 1, focusId: undefined });
            }} options={[10, 20, 50].map((size) => ({ value: String(size), label: t("{count} 条 / 页", { count: size }) }))} />
            <Pagination aria-label={t("备货计划分页")} className="mx-0 w-auto"><PaginationContent>
              <PaginationItem><Button type="button" variant="outline" size="icon" className="size-8" aria-label={t("上一页")} title={t("上一页")} disabled={paginationDisabled || currentPage === 1} onClick={() => changePage(currentPage - 1)}><ChevronLeft aria-hidden="true" className="size-4" /></Button></PaginationItem>
              {pageNumbers.map((number, index) => <PaginationItem key={number} className="flex items-center gap-1">
                {index > 0 && number - pageNumbers[index - 1] > 1 && <PaginationEllipsis className="size-8" />}
                <Button type="button" variant={number === currentPage ? "secondary" : "ghost"} size="icon" className="size-8 text-xs tabular-nums" aria-label={t("第 {page} 页", { page: number })} aria-current={number === currentPage ? "page" : undefined} disabled={paginationDisabled} onClick={() => changePage(number)}>{number}</Button>
              </PaginationItem>)}
              <PaginationItem><Button type="button" variant="outline" size="icon" className="size-8" aria-label={t("下一页")} title={t("下一页")} disabled={paginationDisabled || currentPage === pageCount} onClick={() => changePage(currentPage + 1)}><ChevronRight aria-hidden="true" className="size-4" /></Button></PaginationItem>
            </PaginationContent></Pagination>
          </div>
        </div>}
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
