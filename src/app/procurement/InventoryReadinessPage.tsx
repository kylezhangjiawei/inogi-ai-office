import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { useNavigate, useSearchParams } from "react-router";
import {
  AlertCircle,
  ArrowRight,
  Boxes,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  CircleGauge,
  DatabaseZap,
  Factory,
  PackageCheck,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  ShieldAlert,
  Target,
  Truck,
  Trash2,
  Warehouse,
} from "lucide-react";
import { toast } from "sonner";

import { AutoTranslatedText } from "../components/TranslatableText";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "../components/ui/dialog";
import { Textarea } from "../components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "../components/ui/sheet";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../components/ui/table";
import { cn } from "../components/ui/utils";
import { usePermission } from "../hooks/usePermission";
import { i18nLocale, useI18n } from "../lib/i18n";
import {
  getInventoryReadiness,
  getInventoryMaterialReference,
  saveInventoryBomLine,
  deleteInventoryBomLine,
  type InventoryBomLine,
  type InventoryReadinessItem,
  type InventoryReadinessResponse,
  type InventoryReadinessStatus,
} from "../lib/procurementApi";
import { routePath } from "../lib/routePaths";
import { PageHeader } from "./components/common";
import { Q5PackagingInventory } from "./components/Q5PackagingInventory";
import { getInventoryDiagnosticCopy, InventoryMatchExplanation } from "./components/InventoryMatchExplanation";

const DEFAULT_TARGET_SETS = 100;
const DEFAULT_PAGE_SIZE = 20;

const STATUS_META: Record<InventoryReadinessStatus, { label: string; className: string }> = {
  ready: { label: "目标可覆盖", className: "border-emerald-200 bg-emerald-50 text-emerald-700" },
  low: { label: "低于安全库存", className: "border-amber-200 bg-amber-50 text-amber-700" },
  gap: { label: "目标有缺口", className: "border-orange-200 bg-orange-50 text-orange-700" },
  shortage: { label: "当前缺货", className: "border-rose-200 bg-rose-50 text-rose-700" },
  unmatched: { label: "量产仓记录待匹配", className: "border-rose-200 bg-rose-50 text-rose-700" },
  data_missing: { label: "BOM 待完善", className: "border-slate-200 bg-slate-100 text-slate-600" },
};

function quantity(value: number, maximumFractionDigits = 4) {
  return new Intl.NumberFormat(i18nLocale(), { maximumFractionDigits }).format(value);
}

function percent(value: number) {
  return new Intl.NumberFormat(i18nLocale(), { style: "percent", maximumFractionDigits: 0 }).format(value);
}

function targetFromQuery(raw: string | null) {
  if (raw === null || raw.trim() === "") return DEFAULT_TARGET_SETS;
  const value = Number(raw);
  return Number.isFinite(value) ? Math.min(1_000_000, Math.max(0, Math.floor(value))) : DEFAULT_TARGET_SETS;
}

function affectedSets(item: InventoryReadinessItem) {
  return item.qtyPer && item.qtyPer > 0 ? Math.max(0, item.gapAfterTransit) / item.qtyPer : 0;
}

function comparePriority(a: InventoryReadinessItem, b: InventoryReadinessItem) {
  return Number(Boolean(b.issue)) - Number(Boolean(a.issue))
    || affectedSets(b) - affectedSets(a)
    || a.currentSets - b.currentSets;
}

function hasVerifiedGap(item: InventoryReadinessItem) {
  return Boolean(item.code?.trim() && !item.issue && item.qtyPer && item.qtyPer > 0
    && Number.isFinite(item.gapAfterTransit) && item.gapAfterTransit > 0
    && item.syncedAt && Number.isFinite(Date.parse(item.syncedAt)));
}

function syncDate(value?: string | null) {
  const timestamp = value ? Date.parse(value) : NaN;
  return Number.isFinite(timestamp)
    ? new Intl.DateTimeFormat(i18nLocale(), { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).format(timestamp)
    : null;
}

function inventoryStatusLabel(item: InventoryReadinessItem) {
  return item.status === "unmatched" ? getInventoryDiagnosticCopy(item.inventoryDiagnostic).label : STATUS_META[item.status].label;
}

function inventoryQuantity(item: InventoryReadinessItem, value: number, fractionDigits = 4) {
  return item.status === "unmatched" || item.inventoryDiagnostic ? "—" : quantity(value, fractionDigits);
}

function StatusBadge({ item }: { item: InventoryReadinessItem }) {
  const { t } = useI18n();
  const meta = STATUS_META[item.status];
  return (
    <span className={cn("inline-flex whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px] font-semibold", meta.className)}>
      {t(inventoryStatusLabel(item))}
    </span>
  );
}

function MetricCard({
  Icon,
  label,
  value,
  note,
  actionLabel,
  onClick,
  tone = "blue",
}: {
  Icon: typeof Boxes;
  label: string;
  value: string | number;
  note: string;
  actionLabel: string;
  onClick: () => void;
  tone?: "blue" | "rose" | "amber" | "emerald";
}) {
  const tones = {
    blue: "bg-[#eef3ff] text-[#002fa7]",
    rose: "bg-rose-50 text-rose-600",
    amber: "bg-amber-50 text-amber-600",
    emerald: "bg-emerald-50 text-emerald-700",
  };
  return (
    <button
      type="button"
      aria-label={actionLabel}
      onClick={onClick}
      className="group min-w-0 cursor-pointer border-r border-slate-100 px-4 py-3 text-left transition-colors duration-200 last:border-r-0 hover:bg-[#f7f9ff] focus-visible:z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#002fa7]/35"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-medium text-slate-500">{label}</p>
          <p className="mt-1 text-2xl font-bold tracking-[-0.04em] text-slate-900 tabular-nums">{value}</p>
          <p className="mt-1 truncate text-[11px] text-slate-400">{note}</p>
        </div>
        <span className="flex shrink-0 items-center gap-1" aria-hidden="true">
          <span className={cn("flex size-8 items-center justify-center rounded-lg", tones[tone])}>
            <Icon className="size-4" />
          </span>
          <ChevronRight className="size-3.5 text-slate-300 transition-transform duration-200 group-hover:translate-x-0.5 group-hover:text-[#002fa7] motion-reduce:transition-none" />
        </span>
      </div>
    </button>
  );
}

type DrilldownKind = "warning" | "transit" | "bottleneck" | "bom";

function ReadinessRail({ data }: { data: InventoryReadinessResponse }) {
  const { t } = useI18n();
  const { summary } = data;
  const target = Math.max(1, summary.targetSets);
  const currentPercent = Math.min(100, (summary.currentBuildableSets / target) * 100);
  const transitPercent = Math.min(100, (summary.withTransitBuildableSets / target) * 100);
  return (
    <section className="overflow-hidden rounded-[14px] border border-[#dce4f2] bg-white shadow-[0_14px_35px_-34px_rgba(15,23,42,.5)]">
      <div className="grid items-stretch lg:grid-cols-[minmax(210px,.8fr)_minmax(420px,2fr)]">
        <div className="flex flex-col justify-between border-b border-[#e5eaf2] bg-[#f8faff] px-5 py-5 lg:border-r lg:border-b-0">
          <div>
            <div className="flex items-center gap-2 text-xs font-semibold text-[#002fa7]">
              <CircleGauge className="size-4" aria-hidden="true" />
              {t(data.productLine === "Q5"
                ? data.dataQuality.provisional ? "当前装配物料可齐套（估算）" : "当前装配物料可齐套"
                : data.dataQuality.provisional ? "当前物料可齐套（估算）" : "当前物料可齐套")}
            </div>
            <div className="mt-3 flex items-end gap-2">
              <span className="text-5xl font-bold tracking-[-0.065em] text-[#142044] tabular-nums">{quantity(summary.currentBuildableSets, 0)}</span>
              <span className="pb-1.5 text-sm font-semibold text-slate-500">{t("套")}</span>
            </div>
          </div>
          <p className="mt-4 text-xs leading-5 text-slate-500">{t("仅按 BOM 与量产仓库可用库存核算，不包含产能与人员排程。")}</p>
          {data.productLine === "Q5" && <p className="mt-1 text-xs leading-5 text-slate-500">{t("包材与随箱配件的配套数量待确认，见下方清单。")}</p>}
        </div>

        <div className="px-5 py-5 sm:px-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-slate-900">{t("{model} 齐套路径", { model: data.productLine })}</p>
              <p className="mt-1 text-xs text-slate-500">{t("库存可用量 → 确认在途 → 目标缺口")}</p>
            </div>
            <div className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs text-slate-600">
              {t("目标")} <strong className="ml-1 text-slate-900 tabular-nums">{quantity(summary.targetSets, 0)} {t("套")}</strong>
            </div>
          </div>

          <div className="mt-7">
            <div className="relative h-2 overflow-hidden rounded-full bg-slate-100" aria-label={t("齐套进度")}>
              <div className="absolute inset-y-0 left-0 bg-[#002fa7] transition-[width] duration-500 motion-reduce:transition-none" style={{ width: `${currentPercent}%` }} />
              <div className="absolute inset-y-0 bg-emerald-400 transition-[left,width] duration-500 motion-reduce:transition-none" style={{ left: `${currentPercent}%`, width: `${Math.max(0, transitPercent - currentPercent)}%` }} />
            </div>
            <div className="mt-3 grid grid-cols-3 gap-3">
              <div>
                <p className="text-[11px] text-slate-400">{t("当前齐套")}</p>
                <p className="mt-0.5 text-base font-bold text-[#002fa7] tabular-nums">{quantity(summary.currentBuildableSets, 0)}</p>
              </div>
              <div className="text-center">
                <p className="text-[11px] text-slate-400">{t("在途到齐后")}</p>
                <p className="mt-0.5 text-base font-bold text-emerald-700 tabular-nums">{quantity(summary.withTransitBuildableSets, 0)}</p>
              </div>
              <div className="text-right">
                <p className="text-[11px] text-slate-400">{t(data.dataQuality.provisional ? "目标差额（估算）" : "仍缺")}</p>
                <p className={cn("mt-0.5 text-base font-bold tabular-nums", summary.targetGapAfterTransit > 0 ? "text-rose-600" : "text-emerald-700")}>
                  {quantity(summary.targetGapAfterTransit, 0)} {t("套")}
                </p>
              </div>
            </div>
            {data.dataQuality.provisional && <p className="mt-3 text-[11px] leading-5 text-amber-800">{t("数据尚未核实完整，齐套与目标差额仅为估算，不能直接作为采购数量。")}</p>}
          </div>
        </div>
      </div>
    </section>
  );
}

type BomEditorState = { mode: "create" | "edit" | "delete"; lines: InventoryBomLine[] };

function InventoryBomEditor({ editor, positions, onClose, onSaved }: {
  editor: BomEditorState;
  positions: Array<{ id: string; name: string }>;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t } = useI18n();
  const initial = editor.lines.length === 1 ? editor.lines[0] : undefined;
  const [lineId, setLineId] = useState(initial?.id ?? "");
  const [name, setName] = useState(initial?.name ?? "");
  const [code, setCode] = useState(initial?.code ?? "");
  const [qty, setQty] = useState(initial?.qtyPer === null || initial?.qtyPer === undefined ? "" : String(initial.qtyPer));
  const [parentId, setParentId] = useState(initial?.parentId ?? "");
  const [remark, setRemark] = useState(initial?.remark ?? "");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [materialLookup, setMaterialLookup] = useState<{ code: string; data?: { matched: boolean; category: string; unit: string }; error?: string } | null>(null);
  const [lookupAttempt, setLookupAttempt] = useState(0);
  const savingRef = useRef(false);
  const activeRef = useRef(true);
  useEffect(() => { activeRef.current = true; return () => { activeRef.current = false; }; }, []);
  const line = editor.lines.find((entry) => entry.id === lineId);
  const deleting = editor.mode === "delete";
  const ready = editor.mode === "create" || Boolean(line);
  const lookupCode = code.trim();
  useEffect(() => {
    if (deleting || !ready || !lookupCode) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      setMaterialLookup({ code: lookupCode });
      void getInventoryMaterialReference(lookupCode, controller.signal).then((data) => {
        if (!controller.signal.aborted) setMaterialLookup({ code: lookupCode, data });
      }).catch((err) => {
        if (!controller.signal.aborted) setMaterialLookup({ code: lookupCode, error: err instanceof Error ? err.message : t("物料分类读取失败") });
      });
    }, 220);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [lookupCode, deleting, ready, lookupAttempt, t]);
  const lookupCurrent = materialLookup?.code === lookupCode ? materialLookup : null;
  const materialCategory = !lookupCode ? t("输入物料编码后自动带出")
    : lookupCurrent?.error ? t("读取失败")
      : !lookupCurrent?.data ? t("正在读取物料分类…")
        : lookupCurrent.data.matched ? lookupCurrent.data.category : t("未匹配物料库");
  const title = deleting ? t("删除通用物料") : editor.mode === "edit" ? t("编辑通用物料") : t("新增通用物料");
  const chooseLine = (id: string) => {
    const entry = editor.lines.find((candidate) => candidate.id === id);
    setLineId(id); setName(entry?.name ?? ""); setCode(entry?.code ?? "");
    setQty(entry?.qtyPer === null || entry?.qtyPer === undefined ? "" : String(entry.qtyPer));
    setParentId(entry?.parentId ?? ""); setRemark(entry?.remark ?? ""); setSaveError("");
  };
  const close = () => { if (!savingRef.current) onClose(); };
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (savingRef.current || !ready) return;
    setSaveError("");
    const amount = Number(qty);
    if (!deleting && (!name.trim() || !code.trim() || !qty.trim() || !Number.isFinite(amount) || amount <= 0 || amount >= 10_000_000_000 || !/^\d+(\.\d{1,4})?$/.test(qty.trim()))) {
      setSaveError(t("请填写物料名称、编码和大于 0 的单机用量；用量最多保留 4 位小数。"));
      return;
    }
    savingRef.current = true; setSaving(true);
    try {
      if (deleting && line) await deleteInventoryBomLine(line.id, line.updatedAt);
      else await saveInventoryBomLine({ name: name.trim(), code: code.trim(), qtyPer: amount, parentId: parentId || null, remark: remark.trim(), ...(line ? { baseUpdatedAt: line.updatedAt } : {}) }, line?.id);
      if (!activeRef.current) return;
      toast.success(deleting ? t("已删除该物料来源，正在重新计算齐套") : t("物料配置已保存，正在重新计算齐套"));
      onSaved();
    } catch (err) {
      if (activeRef.current) setSaveError(err instanceof Error ? err.message : t("操作失败，请重试"));
    } finally {
      savingRef.current = false;
      if (activeRef.current) setSaving(false);
    }
  };
  return <Dialog open onOpenChange={(open) => { if (!open) close(); }}>
    <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-xl" onEscapeKeyDown={(event) => { if (savingRef.current) event.preventDefault(); }} onPointerDownOutside={(event) => { if (savingRef.current) event.preventDefault(); }}>
      <DialogHeader>
        <DialogTitle>{title}</DialogTitle>
        <DialogDescription>{deleting ? t("删除当前通用 BOM 中的一条物料来源，齐套数量和缺口会重新计算。物料库、库存及采购记录会保留。") : t("维护通用 BOM 的物料配置，保存后按最新单机用量重新计算齐套。库存和在途由 T+ 同步。")}</DialogDescription>
      </DialogHeader>
      <form onSubmit={submit} className="space-y-4">
        {editor.lines.length > 1 && <div className="space-y-2 rounded-lg border border-blue-100 bg-blue-50/50 p-3">
          <p className="text-xs leading-5 text-slate-600">{t("此行合并了 {count} 条来源的用量，请选择要维护的具体来源。", { count: editor.lines.length })}</p>
          <label className="grid gap-1.5 text-xs font-medium text-slate-700">{t("物料来源")}
            <select aria-label={t("物料来源")} value={lineId} disabled={saving} onChange={(event) => chooseLine(event.target.value)} className="h-10 rounded-md border border-slate-200 bg-white px-3 text-sm">
              <option value="">{t("请选择具体来源")}</option>
              {editor.lines.map((entry, index) => <option key={entry.id} value={entry.id}>{index + 1}. {entry.bomPosition || t("未指定位置")} · {entry.name} · {t("单机用量")} {entry.qtyPer ?? "—"}</option>)}
            </select>
          </label>
        </div>}
        {ready && (deleting ? <div className="space-y-2 rounded-lg border border-rose-100 bg-rose-50/60 p-4 text-sm">
          <p className="font-semibold text-slate-900">{line?.code || t("编码待补")} · {line?.name}</p>
          <p className="text-slate-600">{t("物料分类")}：{line?.category || t("未分类")}</p>
          <p className="text-slate-600">{t("BOM 所属位置")}：{line?.bomPosition || t("未指定位置")} · {t("单机用量")} {line?.qtyPer ?? "—"} {line?.unit}</p>
          {editor.lines.length > 1 && <p className="text-xs text-rose-700">{t("仅删除以上来源，其余 {count} 条来源保留。", { count: editor.lines.length - 1 })}</p>}
        </div> : <fieldset disabled={saving} className="grid gap-4 sm:grid-cols-2">
          <label className="grid gap-1.5 text-xs font-medium text-slate-700 sm:col-span-2">{t("物料名称")}<Input aria-label={t("物料名称")} required maxLength={200} value={name} onChange={(event) => setName(event.target.value)} /></label>
          <label className="grid gap-1.5 text-xs font-medium text-slate-700">{t("物料编码")}<Input aria-label={t("物料编码")} required maxLength={100} value={code} onChange={(event) => setCode(event.target.value)} /></label>
          <label className="grid gap-1.5 text-xs font-medium text-slate-700">{t("单机用量")}<Input aria-label={t("单机用量")} type="number" required min="0.0001" max="9999999999.9999" step="0.0001" value={qty} onChange={(event) => setQty(event.target.value)} /></label>
          <label className="grid gap-1.5 text-xs font-medium text-slate-700">{t("物料分类")}
            <Input aria-label={t("物料分类")} readOnly value={materialCategory} className="bg-slate-50 text-slate-600" />
          </label>
          <label className="grid gap-1.5 text-xs font-medium text-slate-700">{t("BOM 所属位置")}
            <select aria-label={t("BOM 所属位置")} value={parentId} onChange={(event) => setParentId(event.target.value)} className="h-10 rounded-md border border-slate-200 bg-white px-3 text-sm">
              <option value="">{t("未指定位置")}</option>
              {positions.map((entry) => <option key={entry.id} value={entry.id}>{entry.name}</option>)}
            </select>
          </label>
          <div className="text-xs leading-5 text-slate-500 sm:col-span-2">
            <p>{t("物料分类按编码从物料库带出，请在物料库统一维护；BOM 所属位置用于区分使用部位。")}</p>
            {lookupCurrent?.error && <p role="alert" className="mt-1 text-rose-600">{lookupCurrent.error} <button type="button" className="font-semibold underline" onClick={() => { setMaterialLookup(null); setLookupAttempt((value) => value + 1); }}>{t("重试读取分类")}</button></p>}
          </div>
          <p className="text-xs leading-5 text-slate-500 sm:col-span-2">{t("编码用于匹配库存。数量单位沿用匹配物料的单位，未匹配时按件计算。")}</p>
          <label className="grid gap-1.5 text-xs font-medium text-slate-700 sm:col-span-2">{t("备注")}<Textarea aria-label={t("备注")} maxLength={1000} value={remark} onChange={(event) => setRemark(event.target.value)} /></label>
        </fieldset>)}
        {saveError && <p role="alert" className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{saveError}</p>}
        <DialogFooter>
          <Button type="button" variant="outline" disabled={saving} onClick={close}>{t("取消")}</Button>
          <Button type="submit" variant={deleting ? "destructive" : "default"} disabled={saving || !ready}>{saving ? t("处理中…") : deleting ? t("确认删除") : t("保存物料")}</Button>
        </DialogFooter>
      </form>
    </DialogContent>
  </Dialog>;
}

export function InventoryReadinessPage() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const requestedProductLine = searchParams.get("productLine")?.trim() || "Q5";
  const requestedTargetSets = targetFromQuery(searchParams.get("targetSets"));
  const canViewMaterials = usePermission("page:proc-materials");
  const canViewPurchaseOrders = usePermission("page:purchase-orders");
  const canViewStockPlans = usePermission("page:proc-cockpit");
  const canCreateTask = usePermission("proc-task:create");
  const canCreateStockPlan = canViewStockPlans && canCreateTask;
  const canManageBom = usePermission("material:import");
  const [bomEditor, setBomEditor] = useState<BomEditorState | null>(null);
  const [data, setData] = useState<InventoryReadinessResponse | null>(null);
  const [productLine, setProductLine] = useState(requestedProductLine);
  const [targetDraft, setTargetDraft] = useState(String(requestedTargetSets));
  const [targetSets, setTargetSets] = useState(requestedTargetSets);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("all");
  const [status, setStatus] = useState("all");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  const [drilldown, setDrilldown] = useState<DrilldownKind | null>(null);
  const [selected, setSelected] = useState<InventoryReadinessItem | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const loadRequestRef = useRef(0);

  useEffect(() => {
    setProductLine(requestedProductLine);
    setTargetSets(requestedTargetSets);
    setTargetDraft(String(requestedTargetSets));
    setSelected(null);
  }, [requestedProductLine, requestedTargetSets]);

  const load = useCallback(async (signal?: AbortSignal) => {
    const requestId = ++loadRequestRef.current;
    setLoading(true);
    setError("");
    try {
      const next = await getInventoryReadiness({ productLine, targetSets }, signal);
      if (signal?.aborted || requestId !== loadRequestRef.current) return;
      if (next.productLine !== productLine) throw new Error(t("返回的 BOM 型号与所选型号不一致，请刷新后重试。"));
      setData(next);
    } catch (loadError) {
      if (signal?.aborted || requestId !== loadRequestRef.current) return;
      setError(loadError instanceof Error ? loadError.message : t("库存齐套数据加载失败"));
    } finally {
      if (!signal?.aborted && requestId === loadRequestRef.current) setLoading(false);
    }
  }, [productLine, targetSets, t]);

  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(() => void load(controller.signal), 220);
    return () => {
      loadRequestRef.current += 1;
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [load]);

  useEffect(() => {
    setSelected((current) => current ? data?.items.find((item) => item.id === current.id) ?? null : null);
  }, [data]);

  const categories = useMemo(
    () => [...new Set((data?.items ?? []).flatMap((item) => [item.category, ...(item.sourceLines ?? []).map((line) => line.category)]).filter(Boolean))].sort((a, b) => a.localeCompare(b, "zh-CN")),
    [data?.items],
  );
  const filteredItems = useMemo(() => {
    const keyword = query.trim().toLocaleLowerCase("zh-CN");
    return (data?.items ?? []).filter((item) => {
      const sourceText = (item.sourceLines ?? []).map((line) => `${line.name} ${line.category} ${line.bomPosition ?? ""} ${line.remark ?? ""}`).join(" ");
      if (keyword && !`${item.code ?? ""} ${item.name} ${item.spec} ${item.category} ${item.bomPosition ?? ""} ${sourceText}`.toLocaleLowerCase("zh-CN").includes(keyword)) return false;
      if (category !== "all" && item.category !== category && !item.sourceLines?.some((line) => line.category === category)) return false;
      if (status === "warning" && item.status === "ready") return false;
      if (status !== "all" && status !== "warning" && item.status !== status) return false;
      return true;
    }).sort(comparePriority);
  }, [category, data?.items, query, status]);
  const totalPages = Math.max(1, Math.ceil(filteredItems.length / pageSize));
  const pagedItems = useMemo(
    () => filteredItems.slice((page - 1) * pageSize, page * pageSize),
    [filteredItems, page, pageSize],
  );
  const pageStart = filteredItems.length === 0 ? 0 : (page - 1) * pageSize + 1;
  const pageEnd = Math.min(page * pageSize, filteredItems.length);

  useEffect(() => {
    setPage(1);
  }, [category, productLine, query, status, pageSize]);

  useEffect(() => { setBomEditor(null); }, [productLine]);

  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [page, totalPages]);
  const bottlenecks = useMemo(
    () => (data?.items ?? [])
      .filter((item) => item.status !== "ready")
      .sort(comparePriority)
      .slice(0, 6),
    [data?.items],
  );
  const drilldownItems = useMemo(() => {
    if (!data || !drilldown) return [];
    if (drilldown === "warning") return data.items.filter((item) => item.status !== "ready").sort(comparePriority);
    if (drilldown === "transit") return data.items.filter((item) => item.inTransit > 0);
    if (drilldown === "bottleneck") {
      return data.items.filter((item) => item.status !== "data_missing" && item.qtyPer && item.currentSets === data.summary.currentBuildableSets);
    }
    return data.items.filter((item) => item.status === "data_missing");
  }, [data, drilldown]);
  const drilldownMeta = drilldown ? {
    warning: { label: "库存预警", note: "含缺货、目标缺口与数据异常", Icon: ShieldAlert, tone: "bg-rose-50 text-rose-600" },
    transit: { label: "在途物料", note: "量产仓库已确认在途", Icon: Truck, tone: "bg-[#eef3ff] text-[#002fa7]" },
    bottleneck: { label: "瓶颈物料", note: "决定当前可齐套上限", Icon: Target, tone: "bg-amber-50 text-amber-600" },
    bom: { label: "BOM 可核算率", note: "缺少编码或单机用量的 BOM 行", Icon: DatabaseZap, tone: "bg-amber-50 text-amber-600" },
  }[drilldown] : null;
  const lastSync = syncDate(data?.syncedAt) ?? t("暂无同步记录");
  const unmatchedMaterials = data?.items.filter((item) => item.status === "unmatched").length ?? 0;
  const inventorySyncTimes = [...(data?.items ?? []), ...(data?.packaging?.items ?? [])]
    .map((item) => item.syncedAt ? Date.parse(item.syncedAt) : NaN)
    .filter(Number.isFinite);
  const oldestSyncTime = inventorySyncTimes.length > 0 ? Math.min(...inventorySyncTimes) : null;
  const oldestSync = oldestSyncTime === null ? t("暂无同步记录") : syncDate(new Date(oldestSyncTime).toISOString());
  const staleInventory = oldestSyncTime !== null && Date.now() - oldestSyncTime > 24 * 60 * 60 * 1000;
  const currentData = Boolean(data && !loading && !error && data.productLine === productLine && data.summary.targetSets === targetSets);
  const showBomActions = canManageBom && data?.productLine === "通用" && productLine === "通用";
  const canPlanMachineGap = Boolean(currentData && data && !data.dataQuality.provisional
    && data.summary.targetGapAfterTransit > 0 && data.items.length > 0
    && data.items.every((item) => !item.issue && item.syncedAt && Number.isFinite(Date.parse(item.syncedAt))));

  const commitTarget = () => {
    const parsed = Math.min(1_000_000, Math.max(0, Math.floor(Number(targetDraft) || 0)));
    setTargetDraft(String(parsed));
    setTargetSets(parsed);
  };
  const openMaterialLibrary = (item?: InventoryReadinessItem) => {
    const destination = routePath("page:proc-materials", "/proc-materials");
    if (!item?.code) {
      navigate(destination);
      return;
    }
    const params = new URLSearchParams({ materialCode: item.code });
    navigate(`${destination}?${params.toString()}`);
  };
  const openDrilldownItem = (item: InventoryReadinessItem) => {
    setDrilldown(null);
    setSelected(item);
  };
  const openStockPlan = (item?: InventoryReadinessItem) => {
    if (!canCreateStockPlan || !currentData || !data) return;
    if (item ? !hasVerifiedGap(item) : !canPlanMachineGap) return;
    const params = new URLSearchParams({
      tab: "stock-plans", newPlan: "1", planType: item ? "material" : "machine",
      productLine: data.productLine,
      targetQty: String(item ? item.targetDemand : data.summary.targetSets),
      note: item
        ? t("库存齐套核算：目标总需求 {demand} {unit}，当前缺口 {gap}，量产可用 {available}，在途 {transit}。", { demand: quantity(item.targetDemand), unit: item.unit, gap: quantity(item.gapAfterTransit), available: quantity(item.available), transit: quantity(item.inTransit) })
        : t("库存齐套核算：目标 {target} 套，当前可齐套 {current} 套，在途到齐后 {transit} 套，仍缺 {gap} 套。", { target: data.summary.targetSets, current: data.summary.currentBuildableSets, transit: data.summary.withTransitBuildableSets, gap: data.summary.targetGapAfterTransit }),
    });
    if (item) {
      params.set("materialCode", item.code!);
      params.set("materialName", item.name);
      params.set("unit", item.unit);
    }
    navigate(`${routePath("page:proc-cockpit", "/proc-cockpit")}?${params.toString()}`);
  };

  return (
    <div className="proc-horizon mx-auto block h-full min-h-0 w-full max-w-[1680px] overflow-auto p-3 sm:p-4">
      <PageHeader
        Icon={Factory}
        badge={t("供应链管理")}
        title={t("库存齐套中心")}
        description={t("把 {model} BOM、量产仓库库存与确认在途放到同一条决策线上，快速定位限制交付的物料。", { model: data?.productLine || productLine })}
        right={(
          <div className="flex flex-wrap items-end justify-end gap-2">
            <label className="grid gap-1 text-[11px] font-medium text-slate-500">
              <span>{t("产品型号")}</span>
              <Select value={productLine} onValueChange={(value) => { setProductLine(value); setCategory("all"); }} disabled={!data?.models.length}>
                <SelectTrigger className="h-9 min-w-28 border-slate-200 bg-white" aria-label={t("选择产品型号")}>
                  <SelectValue placeholder={t(loading ? "正在加载型号" : "暂无型号")} />
                </SelectTrigger>
                <SelectContent>
                  {(data?.models ?? []).map((model) => (
                    <SelectItem key={model.id} value={model.id}>{model.id === "Q5" ? t("Q5 · 整机装配") : model.label} · {model.bomLines}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </label>
            <label className="grid gap-1 text-[11px] font-medium text-slate-500">
              <span>{t("目标套数")}</span>
              <Input
                type="number"
                min={0}
                max={1_000_000}
                step={1}
                value={targetDraft}
                onChange={(event) => setTargetDraft(event.target.value)}
                onBlur={commitTarget}
                onKeyDown={(event) => { if (event.key === "Enter") { event.currentTarget.blur(); } }}
                className="h-9 w-28 border-slate-200 bg-white text-right font-semibold tabular-nums"
                aria-label={t("目标套数")}
              />
            </label>
            <div className="grid gap-1 text-[11px] font-medium text-slate-500">
              <span>{t("库存范围")}</span>
              <div className="flex h-9 items-center gap-2 rounded-md border border-slate-200 bg-slate-50 px-3 text-sm font-semibold text-slate-700">
                <Warehouse className="size-4 text-[#002fa7]" aria-hidden="true" />
                {t("量产仓库")}
              </div>
            </div>
            <Button type="button" variant="outline" size="sm" disabled={loading} onClick={() => void load()} className="h-9 border-slate-200 bg-white text-slate-600">
              <RefreshCw className={cn("size-4", loading && "animate-spin")} aria-hidden="true" />
              {t("刷新")}
            </Button>
          </div>
        )}
      />

      {data ? (
        <div role="status" className={cn("mb-3 flex flex-wrap items-start justify-between gap-2 rounded-xl border px-4 py-3 text-xs", staleInventory || oldestSyncTime === null ? "border-amber-200 bg-amber-50 text-amber-900" : "border-slate-200 bg-slate-50 text-slate-600")}>
          <div>
            <p className="font-semibold">{t("ERP 库存快照")} · {t("最早一条同步")}：{oldestSync}</p>
            <p className="mt-1">{t("最近一条同步")}：{lastSync} · {t("刷新页面只重新读取已同步库存。")}</p>
          </div>
          {staleInventory ? <p className="font-semibold">{t("部分库存超过 24 小时未更新，请核对 T+ 同步后再安排采购。")}</p>
            : oldestSyncTime === null ? <p className="font-semibold">{t("尚无有效库存同步记录，请先同步 ERP 数据。")}</p> : null}
        </div>
      ) : null}

      {error ? (
        <div role="alert" className="mb-3 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          <span className="flex items-center gap-2"><AlertCircle className="size-4" aria-hidden="true" />{error}</span>
          <Button type="button" variant="outline" size="sm" onClick={() => void load()} className="border-rose-200 bg-white text-rose-700">{t("重新加载")}</Button>
        </div>
      ) : null}

      {data && data.dataQuality.totalBomLines > 0 ? (
        <>
          <ReadinessRail data={data} />

          {canCreateStockPlan ? (
            <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3">
              <p className="text-xs text-slate-500">{t(data.dataQuality.provisional ? "部分 BOM 或量产仓库存记录待核实，请先查看明细中的具体原因，再按缺口备货。" : data.summary.targetGapAfterTransit <= 0 ? "库存与在途已覆盖目标，无需新增缺口备货计划。" : "按目标总套数建立计划，采购量再扣除库存与在途；下一步填写目标日期和所属子系统。")}</p>
              <Button type="button" size="sm" disabled={!canPlanMachineGap} onClick={() => openStockPlan()}>
                <PackageCheck className="size-4" aria-hidden="true" />{t("建立整机备货计划")}
              </Button>
            </div>
          ) : null}

          <section className="mt-3 grid overflow-hidden rounded-[14px] border border-slate-200 bg-white shadow-[0_1px_2px_rgba(15,23,42,.03)] sm:grid-cols-2 xl:grid-cols-4">
            <MetricCard Icon={ShieldAlert} label={t("库存预警")} value={data.summary.warningMaterials} note={t("含缺货、目标缺口与数据异常")} actionLabel={`${t("库存预警")} · ${t("查看详情")}`} onClick={() => setDrilldown("warning")} tone={data.summary.warningMaterials > 0 ? "rose" : "emerald"} />
            <MetricCard Icon={Truck} label={t("在途物料")} value={data.summary.inTransitMaterials} note={t("量产仓库已确认在途")} actionLabel={`${t("在途物料")} · ${t("查看详情")}`} onClick={() => setDrilldown("transit")} tone="blue" />
            <MetricCard Icon={Target} label={t("瓶颈物料")} value={data.summary.bottleneckMaterials} note={t("决定当前可齐套上限")} actionLabel={`${t("瓶颈物料")} · ${t("查看详情")}`} onClick={() => setDrilldown("bottleneck")} tone={data.summary.bottleneckMaterials > 0 ? "amber" : "emerald"} />
            <MetricCard Icon={DatabaseZap} label={t("BOM 可核算率")} value={percent(data.dataQuality.bomCompleteness)} note={`${data.dataQuality.usableBomLines} / ${data.dataQuality.totalBomLines} ${t("条物料")}`} actionLabel={`${t("BOM 可核算率")} · ${t("查看详情")}`} onClick={() => setDrilldown("bom")} tone={data.dataQuality.provisional ? "amber" : "emerald"} />
          </section>

          {data.dataQuality.provisional ? (
            <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50/70 px-4 py-2.5 text-xs text-amber-800">
              <span className="flex min-w-0 items-center gap-2 text-pretty">
                <AlertCircle className="size-4 shrink-0" aria-hidden="true" />
                <span>{t("当前结果为可核算范围估算：{invalid} 条 BOM 数据待完善，{unmatched} 种物料未找到该编码在量产仓的库存记录。", {
                  invalid: data.dataQuality.invalidBomLines,
                  unmatched: unmatchedMaterials,
                })}{unmatchedMaterials > 0 && <span className="mt-1 block">{t("具体原因见物料下方，点击可查看处理建议。— 表示库存数据待核实，不代表实际库存为 0。")}</span>}</span>
              </span>
              {canViewMaterials ? (
                <button type="button" onClick={() => navigate(routePath("page:proc-materials", "/proc-materials"))} className="inline-flex shrink-0 items-center gap-1 font-semibold text-amber-900 hover:text-[#002fa7]">
                  {t("核对物料及库存")}<ArrowRight className="size-3.5" aria-hidden="true" />
                </button>
              ) : null}
            </div>
          ) : null}

          <div className="mt-3 grid gap-3 xl:h-[640px] xl:grid-cols-[minmax(0,2.25fr)_minmax(300px,.75fr)]">
            <section className="flex h-[640px] min-h-0 flex-col overflow-hidden rounded-[14px] border border-slate-200 bg-white shadow-[0_1px_2px_rgba(15,23,42,.03)] xl:h-full">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-4 py-3">
                <div>
                  <h2 className="text-sm font-bold text-slate-900">{t("{model} 物料齐套明细", { model: data.productLine })}</h2>
                  <p className="mt-0.5 text-xs text-slate-500">{t(data.productLine === "Q5" ? "按 Q5 单台装配清单与单机用量核算，电路板按整板计入；库存与在途来自量产仓库。" : "按风险优先排列，库存与在途均来自量产仓库。")}</p>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-xs text-slate-400">{t("显示 {count} 条", { count: filteredItems.length })}</span>
                  {showBomActions && <Button type="button" size="sm" disabled={!currentData} onClick={() => setBomEditor({ mode: "create", lines: [] })}><Plus className="size-4" aria-hidden="true" />{t("新增物料")}</Button>}
                </div>
              </div>
              <div className="flex flex-wrap gap-2 border-b border-slate-100 bg-slate-50/50 px-4 py-3">
                <div className="relative min-w-[220px] flex-1">
                  <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-slate-400" aria-hidden="true" />
                  <Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t("搜索物料编码、名称或规格")} className="h-9 border-slate-200 bg-white pl-9" aria-label={t("搜索物料齐套明细")} />
                </div>
                <Select value={category} onValueChange={setCategory}>
                  <SelectTrigger className="h-9 w-[160px] border-slate-200 bg-white" aria-label={t("按物料分类筛选")}><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">{t("全部物料分类")}</SelectItem>
                    {categories.map((item) => <SelectItem key={item} value={item}><AutoTranslatedText text={item} /></SelectItem>)}
                  </SelectContent>
                </Select>
                <Select value={status} onValueChange={setStatus}>
                  <SelectTrigger className="h-9 w-[150px] border-slate-200 bg-white" aria-label={t("按状态筛选")}><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">{t("全部状态")}</SelectItem>
                    <SelectItem value="warning">{t("仅看预警")}</SelectItem>
                    <SelectItem value="shortage">{t("当前缺货")}</SelectItem>
                    <SelectItem value="gap">{t("目标有缺口")}</SelectItem>
                    <SelectItem value="unmatched">{t("量产仓库存待匹配")}</SelectItem>
                    <SelectItem value="data_missing">{t("BOM 待完善")}</SelectItem>
                    <SelectItem value="ready">{t("目标可覆盖")}</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="min-h-0 flex-1 overflow-auto">
                <Table id="inventory-readiness-table">
                  <TableHeader className="sticky top-0 z-10 bg-white">
                    <TableRow className="border-slate-100 hover:bg-white">
                      <TableHead className="w-[110px] text-[11px] font-semibold text-slate-500">{t("状态")}</TableHead>
                      <TableHead className="min-w-[260px] text-[11px] font-semibold text-slate-500">{t("物料")}</TableHead>
                      <TableHead className="text-right text-[11px] font-semibold text-slate-500">{t("单机用量")}</TableHead>
                      <TableHead className="text-right text-[11px] font-semibold text-slate-500">{t("现存量")}</TableHead>
                      <TableHead className="text-right text-[11px] font-semibold text-slate-500">{t("可用量")}</TableHead>
                      <TableHead className="text-right text-[11px] font-semibold text-slate-500">{t("在途")}</TableHead>
                      <TableHead className="text-right text-[11px] font-semibold text-slate-500">{t("当前可齐套")}</TableHead>
                      <TableHead className="text-right text-[11px] font-semibold text-slate-500">{t("到货后可齐套")}</TableHead>
                      <TableHead className="text-right text-[11px] font-semibold text-slate-500">{t("目标缺口")}</TableHead>
                      {showBomActions && <TableHead className="sticky right-0 min-w-[112px] bg-white text-right text-[11px] font-semibold text-slate-500">{t("操作")}</TableHead>}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {pagedItems.map((item) => (
                      <TableRow key={item.id} tabIndex={0} onClick={() => setSelected(item)} onKeyDown={(event) => { if (event.target === event.currentTarget && (event.key === "Enter" || event.key === " ")) { event.preventDefault(); setSelected(item); } }} className="cursor-pointer border-slate-100 focus-visible:bg-[#f4f7ff] focus-visible:outline-none hover:bg-slate-50/70">
                        <TableCell><StatusBadge item={item} /></TableCell>
                        <TableCell>
                          <div className="min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="shrink-0 rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-slate-600">{item.code || "—"}</span>
                              <span className="truncate text-sm font-semibold text-slate-900"><AutoTranslatedText text={item.name} /></span>
                            </div>
                            <div className="mt-1 flex min-w-0 flex-wrap gap-x-3 gap-y-1 text-[11px] text-slate-400">
                              <span>{t("物料分类")}：<AutoTranslatedText text={item.category} /></span>
                              {item.bomPosition && <span>{t("BOM 所属位置")}：<AutoTranslatedText text={item.bomPosition} /></span>}
                              {(item.sourceLines?.length ?? 0) > 1 && <span className="shrink-0 text-[#002fa7]">{t("{count} 条来源", { count: item.sourceLines!.length })}</span>}
                              {item.spec ? <span className="truncate">· <AutoTranslatedText text={item.spec} /></span> : null}
                            </div>
                            {(item.status === "unmatched" || item.inventoryDiagnostic) && <InventoryMatchExplanation diagnostic={item.inventoryDiagnostic} compact />}
                          </div>
                        </TableCell>
                        <TableCell className="text-right font-medium text-slate-700 tabular-nums">{item.qtyPer ? quantity(item.qtyPer) : "—"}</TableCell>
                        <TableCell className="text-right text-slate-600 tabular-nums">{inventoryQuantity(item, item.stock)}</TableCell>
                        <TableCell className="text-right font-semibold text-slate-800 tabular-nums">{inventoryQuantity(item, item.available)}</TableCell>
                        <TableCell className="text-right tabular-nums"><span className={item.inTransit > 0 ? "font-semibold text-[#002fa7]" : "text-slate-400"}>{inventoryQuantity(item, item.inTransit)}</span></TableCell>
                        <TableCell className="text-right font-bold text-slate-900 tabular-nums">{inventoryQuantity(item, item.currentSets, 0)}</TableCell>
                        <TableCell className="text-right font-bold text-emerald-700 tabular-nums">{inventoryQuantity(item, item.withTransitSets, 0)}</TableCell>
                        <TableCell className="text-right font-bold tabular-nums"><span className={item.gapAfterTransit > 0 ? "text-rose-600" : "text-slate-300"}>{inventoryQuantity(item, item.gapAfterTransit)}</span></TableCell>
                        {showBomActions && <TableCell className="sticky right-0 bg-white text-right" onClick={(event) => event.stopPropagation()}>
                          <div className="flex justify-end gap-1">
                            <Button type="button" variant="ghost" size="sm" className="h-8 gap-1 px-2 text-xs text-[#002fa7]" disabled={!currentData || !item.sourceLines?.length} aria-label={t("编辑物料 {code}", { code: item.code || item.name })} onClick={() => setBomEditor({ mode: "edit", lines: item.sourceLines ?? [] })}><Pencil className="size-3.5" aria-hidden="true" />{t("编辑")}</Button>
                            <Button type="button" variant="ghost" size="sm" className="h-8 gap-1 px-2 text-xs text-rose-600 hover:bg-rose-50 hover:text-rose-700" disabled={!currentData || !item.sourceLines?.length} aria-label={t("删除物料 {code}", { code: item.code || item.name })} onClick={() => setBomEditor({ mode: "delete", lines: item.sourceLines ?? [] })}><Trash2 className="size-3.5" aria-hidden="true" />{t("删除")}</Button>
                          </div>
                        </TableCell>}
                      </TableRow>
                    ))}
                    {filteredItems.length === 0 ? (
                      <TableRow><TableCell colSpan={showBomActions ? 10 : 9} className="h-44 text-center text-sm text-slate-500">{t("没有符合当前条件的物料")}</TableCell></TableRow>
                    ) : null}
                  </TableBody>
                </Table>
              </div>

              <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t border-slate-100 bg-white px-4 py-3 text-xs text-slate-500">
                <span className="tabular-nums">
                  {t("显示 {start}-{end} / 共 {total} 条", { start: pageStart, end: pageEnd, total: filteredItems.length })}
                </span>
                <div className="flex items-center gap-2">
                  <span className="hidden text-slate-400 sm:inline">{t("每页")}</span>
                  <Select value={String(pageSize)} onValueChange={(value) => setPageSize(Number(value))}>
                    <SelectTrigger aria-label={t("每页条数")} className="h-8 w-[74px] border-slate-200 bg-white text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {[20, 50, 100].map((size) => <SelectItem key={size} value={String(size)}>{size}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <span className="min-w-[74px] text-center font-medium text-slate-600 tabular-nums">
                    {t("第 {page}/{total} 页", { page, total: totalPages })}
                  </span>
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    aria-label={t("上一页")}
                    disabled={page <= 1}
                    onClick={() => setPage((current) => Math.max(1, current - 1))}
                    className="size-8 border-slate-200 bg-white"
                  >
                    <ChevronLeft className="size-4" aria-hidden="true" />
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    aria-label={t("下一页")}
                    disabled={page >= totalPages}
                    onClick={() => setPage((current) => Math.min(totalPages, current + 1))}
                    className="size-8 border-slate-200 bg-white"
                  >
                    <ChevronRight className="size-4" aria-hidden="true" />
                  </Button>
                </div>
              </div>
            </section>

            <aside className="flex h-[360px] min-h-0 flex-col overflow-hidden rounded-[14px] border border-slate-200 bg-white shadow-[0_1px_2px_rgba(15,23,42,.03)] xl:h-full">
              <div className="border-b border-slate-100 px-4 py-3">
                <div className="flex items-center gap-2">
                  <span className="flex size-8 items-center justify-center rounded-lg bg-rose-50 text-rose-600"><ShieldAlert className="size-4" aria-hidden="true" /></span>
                  <div>
                    <h2 className="text-sm font-bold text-slate-900">{t("优先处理")}</h2>
                    <p className="mt-0.5 text-[11px] text-slate-500">{t("先核对数据异常，再按缺口影响套数排序")}</p>
                  </div>
                </div>
              </div>
              <div className="min-h-0 flex-1 divide-y divide-slate-100 overflow-auto">
                {bottlenecks.map((item, index) => (
                  <button key={item.id} type="button" onClick={() => setSelected(item)} className="group flex w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-slate-50 focus-visible:bg-slate-50 focus-visible:outline-none">
                    <span className={cn("mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full text-[10px] font-bold tabular-nums", index < 3 ? "bg-rose-50 text-rose-600" : "bg-slate-100 text-slate-500")}>{index + 1}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-xs font-semibold text-slate-800"><AutoTranslatedText text={item.name} /></span>
                      <span className="mt-1 flex items-center justify-between gap-2 text-[11px] text-slate-400">
                        <span>{item.code || t("编码待补")}</span>
                        <span className="font-semibold text-rose-600 tabular-nums">{item.status !== "unmatched" && item.gapAfterTransit > 0 ? `${t("缺")} ${quantity(item.gapAfterTransit)} ${item.unit}` : t(inventoryStatusLabel(item))}</span>
                      </span>
                      {!item.issue && affectedSets(item) > 0 ? <span className="mt-1 block text-[11px] font-semibold text-rose-600">{t("影响 {count} 套", { count: quantity(Math.ceil(affectedSets(item)), 0) })}</span> : null}
                    </span>
                    <ArrowRight className="mt-1 size-3.5 shrink-0 text-slate-300 transition-transform group-hover:translate-x-0.5 group-hover:text-[#002fa7]" aria-hidden="true" />
                  </button>
                ))}
                {bottlenecks.length === 0 ? (
                  <div className="flex h-full min-h-56 flex-col items-center justify-center px-6 text-center">
                    <span className="flex size-10 items-center justify-center rounded-full bg-emerald-50 text-emerald-700"><CheckCircle2 className="size-5" aria-hidden="true" /></span>
                    <p className="mt-3 text-sm font-semibold text-slate-900">{t("目标物料已覆盖")}</p>
                    <p className="mt-1 text-xs leading-5 text-slate-500">{t("当前库存与确认在途已覆盖目标套数。")}</p>
                  </div>
                ) : null}
              </div>
              <div className="border-t border-slate-100 bg-slate-50/60 px-4 py-3 text-[11px] leading-5 text-slate-500">
                <div className="flex items-center gap-2"><PackageCheck className="size-3.5 text-[#002fa7]" aria-hidden="true" />{t("按 ERP 可用量核算；字段未提供时会使用现存量，请核对同步口径。")}</div>
                <div className="mt-1 flex items-center gap-2"><Truck className="size-3.5 text-emerald-600" aria-hidden="true" />{t("在途只展示 ERP 已确认数量。")}</div>
              </div>
            </aside>
          </div>

          <div className="mt-3 flex flex-wrap items-center justify-between gap-2 px-1 pb-1 text-[11px] text-slate-400">
            <span>{t("数据来源：畅捷通 T+（只读）")} · {t("最近一条同步")}：{lastSync}</span>
            <span>{data.warehouse.matchedNames.length > 0 ? `${t("已匹配仓库")}：${data.warehouse.matchedNames.join(" / ")}` : t("未匹配到 ERP 量产仓库")}</span>
          </div>
        </>
      ) : data ? (
        <div className="flex min-h-[32rem] flex-col items-center justify-center rounded-[14px] border border-slate-200 bg-white px-6 text-center shadow-[0_1px_2px_rgba(15,23,42,.03)]">
          <span className="flex size-12 items-center justify-center rounded-xl bg-[#eef3ff] text-[#002fa7]"><Boxes className="size-6" aria-hidden="true" /></span>
          <h2 className="mt-4 text-base font-bold text-slate-900">{data.productLine === "Q5" ? t("Q5 单台装配清单尚未就绪") : t("尚未找到 {model} BOM", { model: data.productLine || productLine })}</h2>
          <p className="mt-2 max-w-md text-sm leading-6 text-slate-500">{t(data.productLine === "Q5" ? "请先按《物料清单》的「原材料」工作表完成 Q5 装配清单初始化，再按物料编码与单机用量核算量产仓库存。" : "请先完成产品 BOM 初始化；库存齐套中心会按物料编码自动连接量产仓库的 ERP 库存。")}</p>
          {showBomActions && <Button type="button" disabled={!currentData} onClick={() => setBomEditor({ mode: "create", lines: [] })} className="mt-4"><Plus className="size-4" aria-hidden="true" />{t("新增物料")}</Button>}
          {canViewMaterials ? <Button type="button" variant="outline" onClick={() => navigate(routePath("page:proc-materials", "/proc-materials"))} className="mt-4 border-slate-200 bg-white text-slate-700">{t("打开物料库")}</Button> : null}
        </div>
      ) : loading ? (
        <div className="flex min-h-[32rem] items-center justify-center rounded-[14px] border border-slate-200 bg-white text-sm text-slate-500">
          <RefreshCw className="mr-2 size-4 animate-spin text-[#002fa7]" aria-hidden="true" />{t("正在核算库存齐套情况…")}
        </div>
      ) : null}

      {productLine === "Q5" && data?.productLine === "Q5" && data.packaging && <Q5PackagingInventory data={data.packaging} />}

      {showBomActions && bomEditor && <InventoryBomEditor
        key={`${productLine}:${bomEditor.mode}:${bomEditor.lines.map((line) => line.id).join(",")}`}
        editor={bomEditor}
        positions={data?.bomPositions ?? []}
        onClose={() => setBomEditor(null)}
        onSaved={() => { setBomEditor(null); setSelected(null); void load(); }}
      />}

      <Sheet open={Boolean(drilldown)} onOpenChange={(open) => { if (!open) setDrilldown(null); }}>
        <SheetContent className="proc-horizon-drawer flex w-full flex-col gap-0 overflow-hidden border-slate-200 bg-[#f7f9fc] p-0 sm:max-w-xl">
          {drilldownMeta ? (
            <>
              <SheetHeader className="shrink-0 border-b border-slate-200 bg-white px-5 py-5 pr-12 text-left">
                <div className="mb-2 flex items-center gap-2">
                  <span className={cn("flex size-8 items-center justify-center rounded-lg", drilldownMeta.tone)}>
                    <drilldownMeta.Icon className="size-4" aria-hidden="true" />
                  </span>
                  <span className="text-xs font-semibold text-slate-500 tabular-nums">{t("显示 {count} 条", { count: drilldownItems.length })}</span>
                </div>
                <SheetTitle className="text-lg font-bold text-slate-900">{t(drilldownMeta.label)}</SheetTitle>
                <SheetDescription className="text-xs leading-5 text-slate-500">{t(drilldownMeta.note)}</SheetDescription>
              </SheetHeader>

              <div className="min-h-0 flex-1 divide-y divide-slate-100 overflow-y-auto bg-white">
                {drilldownItems.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => openDrilldownItem(item)}
                    className="group flex w-full cursor-pointer items-center gap-3 px-5 py-3 text-left transition-colors duration-200 hover:bg-[#f7f9ff] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#002fa7]/35"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="flex min-w-0 items-center gap-2">
                        <span className="shrink-0 rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-slate-600">{item.code || "—"}</span>
                        <span className="truncate text-sm font-semibold text-slate-900"><AutoTranslatedText text={item.name} /></span>
                      </span>
                      <span className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-slate-400">
                        <span>{t("物料分类")}：<AutoTranslatedText text={item.category} /></span>
                        {item.bomPosition && <span>{t("BOM 所属位置")}：<AutoTranslatedText text={item.bomPosition} /></span>}
                        <StatusBadge item={item} />
                      </span>
                    </span>
                    <span className="shrink-0 text-right">
                      <span className={cn("block text-xs font-bold tabular-nums", drilldown === "transit" ? "text-[#002fa7]" : "text-rose-600")}>
                        {item.status === "unmatched" ? t(inventoryStatusLabel(item)) : drilldown === "transit"
                          ? `${t("在途")} ${quantity(item.inTransit)} ${item.unit}`
                          : item.gapAfterTransit > 0
                            ? `${t("缺")} ${quantity(item.gapAfterTransit)} ${item.unit}`
                            : t(STATUS_META[item.status].label)}
                      </span>
                    </span>
                    <ChevronRight className="size-4 shrink-0 text-slate-300 transition-transform duration-200 group-hover:translate-x-0.5 group-hover:text-[#002fa7] motion-reduce:transition-none" aria-hidden="true" />
                  </button>
                ))}
                {drilldownItems.length === 0 ? (
                  <div className="flex min-h-64 flex-col items-center justify-center px-6 text-center">
                    <span className="flex size-10 items-center justify-center rounded-full bg-emerald-50 text-emerald-700"><CheckCircle2 className="size-5" aria-hidden="true" /></span>
                    <p className="mt-3 text-sm font-semibold text-slate-900">{t("没有符合当前条件的物料")}</p>
                  </div>
                ) : null}
              </div>

              {(drilldown === "transit" ? canViewPurchaseOrders : canViewMaterials) ? (
                <div className="shrink-0 border-t border-slate-200 bg-[#f7f9fc] p-4">
                  <Button
                    type="button"
                    variant="outline"
                    className="w-full border-slate-200 bg-white text-slate-700"
                    onClick={() => {
                      if (drilldown === "transit") {
                        const destination = routePath("page:purchase-orders", "/purchase-orders");
                        navigate(`${destination}?status=in_transit`);
                      } else {
                        openMaterialLibrary();
                      }
                    }}
                  >
                    {drilldown === "transit" ? <Truck className="size-4" aria-hidden="true" /> : <Boxes className="size-4" aria-hidden="true" />}
                    {t(drilldown === "transit" ? "查看采购订单" : "打开物料库")}
                    <ArrowRight className="ml-auto size-4" aria-hidden="true" />
                  </Button>
                </div>
              ) : null}
            </>
          ) : null}
        </SheetContent>
      </Sheet>

      <Sheet open={Boolean(selected)} onOpenChange={(open) => { if (!open) setSelected(null); }}>
        <SheetContent className="proc-horizon-drawer w-full gap-0 overflow-y-auto border-slate-200 bg-[#f7f9fc] p-0 sm:max-w-xl">
          {selected ? (
            <>
              <SheetHeader className="border-b border-slate-200 bg-white px-5 py-5 pr-12 text-left">
                <div className="mb-2 flex flex-wrap items-center gap-2"><StatusBadge item={selected} /><span className="rounded bg-slate-100 px-2 py-0.5 font-mono text-[11px] text-slate-600">{selected.code || t("编码待补")}</span></div>
                <SheetTitle className="text-lg font-bold text-slate-900"><AutoTranslatedText text={selected.name} /></SheetTitle>
                <SheetDescription className="text-xs leading-5 text-slate-500">
                  <span className="block">{t("物料分类")}：<AutoTranslatedText text={selected.category} /></span>
                  {selected.bomPosition && <span className="block">{t("BOM 所属位置")}：<AutoTranslatedText text={selected.bomPosition} /></span>}
                  {selected.spec && <span className="block"><AutoTranslatedText text={selected.spec} /></span>}
                </SheetDescription>
              </SheetHeader>
              <div className="space-y-3 p-4">
                <section className="rounded-xl border border-slate-200 bg-white p-4">
                  <h3 className="text-xs font-bold text-slate-900">{t("齐套贡献")}</h3>
                  <div className="mt-3 grid grid-cols-3 divide-x divide-slate-100">
                    <div className="pr-3"><p className="text-[11px] text-slate-400">{t("当前可齐套")}</p><p className="mt-1 text-xl font-bold text-[#002fa7] tabular-nums">{inventoryQuantity(selected, selected.currentSets, 0)}</p></div>
                    <div className="px-3"><p className="text-[11px] text-slate-400">{t("到货后可齐套")}</p><p className="mt-1 text-xl font-bold text-emerald-700 tabular-nums">{inventoryQuantity(selected, selected.withTransitSets, 0)}</p></div>
                    <div className="pl-3"><p className="text-[11px] text-slate-400">{t("目标缺口")}</p><p className="mt-1 text-xl font-bold text-rose-600 tabular-nums">{inventoryQuantity(selected, selected.gapAfterTransit)}</p></div>
                  </div>
                </section>
                <section className="rounded-xl border border-slate-200 bg-white p-4">
                  <h3 className="text-xs font-bold text-slate-900">{t("数量口径")}</h3>
                  <dl className="mt-3 grid grid-cols-2 gap-x-6 gap-y-4 text-xs">
                    <div><dt className="text-slate-400">{t("单机用量")}</dt><dd className="mt-1 font-semibold text-slate-900 tabular-nums">{selected.qtyPer ? `${quantity(selected.qtyPer)} ${selected.unit}` : "—"}</dd></div>
                    <div><dt className="text-slate-400">{t("目标需求量")}</dt><dd className="mt-1 font-semibold text-slate-900 tabular-nums">{quantity(selected.targetDemand)} {selected.unit}</dd></div>
                    <div><dt className="text-slate-400">{t("量产仓库现存量")}</dt><dd className="mt-1 font-semibold text-slate-900 tabular-nums">{inventoryQuantity(selected, selected.stock)} {selected.unit}</dd></div>
                    <div><dt className="text-slate-400">{t("量产仓库可用量")}</dt><dd className="mt-1 font-semibold text-slate-900 tabular-nums">{inventoryQuantity(selected, selected.available)} {selected.unit}</dd></div>
                    <div><dt className="text-slate-400">{t("确认在途")}</dt><dd className="mt-1 font-semibold text-[#002fa7] tabular-nums">{inventoryQuantity(selected, selected.inTransit)} {selected.unit}</dd></div>
                    <div><dt className="text-slate-400">{t("安全库存")}</dt><dd className="mt-1 font-semibold text-slate-900 tabular-nums">{inventoryQuantity(selected, selected.safeStock)} {selected.unit}</dd></div>
                  </dl>
                </section>
                {selected.issue ? (
                  <div role="note" className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs leading-5 text-amber-800">
                    {selected.issue === "missing_code" ? t("该 BOM 行缺少物料编码，无法连接 ERP 库存。") : selected.issue === "missing_qty" ? t("该 BOM 行单机用量为空或为 0，暂不参与齐套计算。") : <InventoryMatchExplanation diagnostic={selected.inventoryDiagnostic} />}
                    {selected.issue === "missing_qty" && selected.inventoryDiagnostic && <InventoryMatchExplanation diagnostic={selected.inventoryDiagnostic} />}
                  </div>
                ) : null}
                {canCreateStockPlan ? (
                  <div className="space-y-2">
                    <Button type="button" disabled={!currentData || !hasVerifiedGap(selected)} onClick={() => openStockPlan(selected)} className="w-full">
                      <PackageCheck className="size-4" aria-hidden="true" />{t("建立物料备货计划")}
                    </Button>
                    <p className="text-xs leading-5 text-slate-500">{t(selected.issue ? "先完善物料编码、BOM 用量及库存映射，再按缺口备货。" : selected.gapAfterTransit <= 0 ? "该物料当前没有采购缺口。" : "计划带入目标总需求，按库存计算采购缺口；下一步填写目标日期和所属子系统。")}</p>
                  </div>
                ) : null}
                {canViewMaterials ? (
                  <Button type="button" variant="outline" onClick={() => openMaterialLibrary(selected)} className="w-full border-slate-200 bg-white text-slate-700">
                    <Boxes className="size-4" aria-hidden="true" />{t("打开物料库")}
                  </Button>
                ) : null}
              </div>
            </>
          ) : null}
        </SheetContent>
      </Sheet>
    </div>
  );
}
