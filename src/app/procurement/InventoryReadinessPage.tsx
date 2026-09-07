import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router";
import {
  AlertCircle,
  ArrowRight,
  Boxes,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  DatabaseZap,
  PackageCheck,
  RefreshCw,
  Search,
  ShieldAlert,
  Target,
  Truck,
  Warehouse,
} from "lucide-react";

import { AutoTranslatedText } from "../components/TranslatableText";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
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
  type InventoryReadinessItem,
  type InventoryReadinessResponse,
  type InventoryReadinessStatus,
} from "../lib/procurementApi";
import { routePath } from "../lib/routePaths";
import { createLatestRequestGate, type LatestRequestGate } from "./procurementLogic";

const DEFAULT_TARGET_SETS = 100;
const DEFAULT_PAGE_SIZE = 20;

const STATUS_META: Record<InventoryReadinessStatus, { label: string; className: string }> = {
  ready: { label: "目标可覆盖", className: "border-emerald-200 bg-emerald-50 text-emerald-700" },
  low: { label: "低于安全库存", className: "border-amber-200 bg-amber-50 text-amber-700" },
  gap: { label: "目标有缺口", className: "border-orange-200 bg-orange-50 text-orange-700" },
  shortage: { label: "当前缺货", className: "border-rose-200 bg-rose-50 text-rose-700" },
  unmatched: { label: "未匹配 ERP", className: "border-rose-200 bg-rose-50 text-rose-700" },
  data_missing: { label: "BOM 待完善", className: "border-slate-200 bg-slate-100 text-slate-600" },
};

function quantity(value: number, maximumFractionDigits = 3) {
  return new Intl.NumberFormat(i18nLocale(), { maximumFractionDigits }).format(value);
}

function percent(value: number) {
  return new Intl.NumberFormat(i18nLocale(), { style: "percent", maximumFractionDigits: 0 }).format(value);
}

function StatusBadge({ status }: { status: InventoryReadinessStatus }) {
  const { t } = useI18n();
  const meta = STATUS_META[status];
  return (
    <span className={cn("inline-flex whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px] font-semibold", meta.className)}>
      {t(meta.label)}
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
  onClick: (opener: HTMLButtonElement) => void;
  tone?: "blue" | "rose" | "amber" | "emerald";
}) {
  const tones = {
    blue: "bg-accent text-primary",
    rose: "bg-rose-50 text-rose-600",
    amber: "bg-amber-50 text-amber-600",
    emerald: "bg-emerald-50 text-emerald-700",
  };
  return (
    <button
      type="button"
      aria-label={actionLabel}
      onClick={(event) => onClick(event.currentTarget)}
      className="proc-readiness-metric group min-w-0 cursor-pointer px-4 py-3 text-left hover:bg-background focus-visible:z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary/35"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-medium text-slate-500">{label}</p>
          <p className="mt-1 text-xl font-bold text-slate-900 tabular-nums">{value}</p>
        </div>
        <span className="flex shrink-0 items-center gap-1" aria-hidden="true">
          <span className={cn("flex size-8 items-center justify-center rounded-lg", tones[tone])}>
            <Icon className="size-4" />
          </span>
          <ChevronRight className="size-3.5 text-slate-300 transition-transform duration-200 group-hover:translate-x-0.5 group-hover:text-primary motion-reduce:transition-none" />
        </span>
      </div>
      <p className="mt-1 text-pretty text-xs text-slate-500">{note}</p>
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
    <section aria-label={t("{model} 齐套路径", { model: data.productLine })} className="proc-readiness-rail rounded-xl border border-slate-200 bg-white p-4">
      <div className="grid grid-cols-3 gap-4">
        <div>
          <p className="text-xs font-medium text-slate-600">{t("当前物料可齐套")}</p>
          <p className="mt-1 text-3xl font-bold tabular-nums text-primary">{quantity(summary.currentBuildableSets, 0)} <span className="text-xs font-medium text-slate-500">{t("套")}</span></p>
        </div>
        <div>
          <p className="text-xs font-medium text-slate-600">{t("在途到齐后")}</p>
          <p className="mt-1 text-3xl font-bold tabular-nums text-emerald-700">{quantity(summary.withTransitBuildableSets, 0)} <span className="text-xs font-medium text-slate-500">{t("套")}</span></p>
        </div>
        <div>
          <p className="text-xs font-medium text-slate-600">{t("目标缺口")}</p>
          <p className={cn("mt-1 text-3xl font-bold tabular-nums", summary.targetGapAfterTransit > 0 ? "text-rose-600" : "text-emerald-700")}>{quantity(summary.targetGapAfterTransit, 0)} <span className="text-xs font-medium text-slate-500">{t("套")}</span></p>
        </div>
      </div>
      <div className="relative mt-3 h-2 overflow-hidden rounded-full bg-slate-100" role="progressbar" aria-label={t("齐套进度")} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(currentPercent)}>
        <div className="absolute inset-y-0 left-0 bg-primary" style={{ width: `${currentPercent}%` }} />
        <div className="absolute inset-y-0 bg-emerald-400" style={{ left: `${currentPercent}%`, width: `${Math.max(0, transitPercent - currentPercent)}%` }} />
      </div>
      <p className="mt-2 text-pretty text-xs text-slate-500">{t("仅按 BOM 与量产仓库可用库存核算，不包含产能与人员排程。")}</p>
    </section>
  );
}

export function InventoryReadinessPage() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const canViewMaterials = usePermission("page:proc-materials");
  const canViewPurchaseOrders = usePermission("page:purchase-orders");
  const [data, setData] = useState<InventoryReadinessResponse | null>(null);
  const [productLine, setProductLine] = useState("Q5");
  const [targetDraft, setTargetDraft] = useState(String(DEFAULT_TARGET_SETS));
  const [targetSets, setTargetSets] = useState(DEFAULT_TARGET_SETS);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("all");
  const [status, setStatus] = useState("all");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  const [drilldown, setDrilldown] = useState<DrilldownKind | null>(null);
  const [selected, setSelected] = useState<InventoryReadinessItem | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [targetError, setTargetError] = useState("");
  const pageRef = useRef<HTMLDivElement>(null);
  const tableScrollRef = useRef<HTMLDivElement>(null);
  const openerRef = useRef<HTMLElement | null>(null);
  const sheetOpenRef = useRef(false);
  sheetOpenRef.current = Boolean(drilldown || selected);
  const requestGateRef = useRef<LatestRequestGate | null>(null);
  if (!requestGateRef.current) requestGateRef.current = createLatestRequestGate();

  const load = useCallback(async (signal?: AbortSignal, requestedTarget = targetSets) => {
    const gate = requestGateRef.current!;
    const token = gate.begin();
    setLoading(true);
    setError("");
    try {
      const next = await getInventoryReadiness({ productLine, targetSets: requestedTarget }, signal);
      if (signal?.aborted || !gate.isCurrent(token)) return;
      setData(next);
      if (next.productLine && next.productLine !== productLine) setProductLine(next.productLine);
    } catch (loadError) {
      if (signal?.aborted || !gate.isCurrent(token)) return;
      setError(loadError instanceof Error ? loadError.message : t("库存齐套数据加载失败"));
    } finally {
      if (!signal?.aborted && gate.isCurrent(token)) setLoading(false);
    }
  }, [productLine, targetSets, t]);

  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(() => void load(controller.signal), 220);
    return () => {
      requestGateRef.current?.invalidate();
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [load]);

  const categories = useMemo(
    () => [...new Set((data?.items ?? []).map((item) => item.category).filter(Boolean))].sort((a, b) => a.localeCompare(b, "zh-CN")),
    [data?.items],
  );
  const filteredItems = useMemo(() => {
    const keyword = query.trim().toLocaleLowerCase("zh-CN");
    return (data?.items ?? []).filter((item) => {
      if (keyword && !`${item.code ?? ""} ${item.name} ${item.spec} ${item.category}`.toLocaleLowerCase("zh-CN").includes(keyword)) return false;
      if (category !== "all" && item.category !== category) return false;
      if (status === "warning" && item.status === "ready") return false;
      if (status !== "all" && status !== "warning" && item.status !== status) return false;
      return true;
    });
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

  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [page, totalPages]);
  useLayoutEffect(() => {
    if (tableScrollRef.current) tableScrollRef.current.scrollTop = 0;
  }, [category, productLine, query, status, page, pageSize]);
  const bottlenecks = useMemo(
    () => (data?.items ?? [])
      .filter((item) => item.status !== "ready")
      .sort((a, b) => b.gapAfterTransit - a.gapAfterTransit || a.currentSets - b.currentSets)
      .slice(0, 6),
    [data?.items],
  );
  const drilldownItems = useMemo(() => {
    if (!data || !drilldown) return [];
    if (drilldown === "warning") return data.items.filter((item) => item.status !== "ready");
    if (drilldown === "transit") return data.items.filter((item) => item.inTransit > 0);
    if (drilldown === "bottleneck") {
      return data.items.filter((item) => item.status !== "data_missing" && item.qtyPer && item.currentSets === data.summary.currentBuildableSets);
    }
    return data.items.filter((item) => item.status === "data_missing");
  }, [data, drilldown]);
  const drilldownMeta = drilldown ? {
    warning: { label: "库存预警", note: "含缺货、目标缺口与数据异常", Icon: ShieldAlert, tone: "bg-rose-50 text-rose-600" },
    transit: { label: "在途物料", note: "量产仓库已确认在途", Icon: Truck, tone: "bg-accent text-primary" },
    bottleneck: { label: "瓶颈物料", note: "决定当前可齐套上限", Icon: Target, tone: "bg-amber-50 text-amber-600" },
    bom: { label: "BOM 可核算率", note: "缺少编码或单机用量的 BOM 行", Icon: DatabaseZap, tone: "bg-amber-50 text-amber-600" },
  }[drilldown] : null;
  const lastSync = data?.syncedAt
    ? new Intl.DateTimeFormat(i18nLocale(), { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date(data.syncedAt))
    : t("暂无同步记录");

  const commitTarget = () => {
    const parsed = Number(targetDraft);
    if (!targetDraft.trim() || !Number.isInteger(parsed) || parsed < 0 || parsed > 1_000_000) {
      setTargetError(t("请输入 0 到 1,000,000 之间的整数套数"));
      return null;
    }
    setTargetError("");
    setTargetDraft(String(parsed));
    setTargetSets(parsed);
    return parsed;
  };
  const clearFilters = () => { setQuery(""); setCategory("all"); setStatus("all"); };
  const hasFilters = Boolean(query.trim() || category !== "all" || status !== "all");
  const openDrilldown = (kind: DrilldownKind, opener: HTMLButtonElement) => {
    openerRef.current = opener;
    setDrilldown(kind);
  };
  const openItem = (item: InventoryReadinessItem, opener: HTMLElement | null) => {
    openerRef.current = opener;
    setSelected(item);
  };
  const restoreSheetFocus = (event: Event) => {
    event.preventDefault();
    if (!sheetOpenRef.current) (openerRef.current?.isConnected ? openerRef.current : pageRef.current)?.focus();
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

  return (
    <div ref={pageRef} tabIndex={-1} className="proc-horizon proc-readiness-page min-w-0 space-y-3">
      <section className="proc-readiness-toolbar rounded-xl border border-slate-200 bg-white p-4">
          <div className="flex flex-wrap items-end gap-3">
            <label className="grid gap-1 text-[11px] font-medium text-slate-500">
              <span>{t("产品型号")}</span>
              <Select value={productLine} onValueChange={(value) => { setProductLine(value); setCategory("all"); }}>
                <SelectTrigger className="h-9 min-w-28 border-slate-200 bg-white" aria-label={t("选择产品型号")}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(data?.models ?? [{ id: "Q5", label: "Q5", bomLines: 136 }]).map((model) => (
                    <SelectItem key={model.id} value={model.id}>{model.label} · {model.bomLines}</SelectItem>
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
                onChange={(event) => { setTargetDraft(event.target.value); setTargetError(""); }}
                aria-invalid={Boolean(targetError)}
                aria-describedby={targetError ? "readiness-target-error" : undefined}
                onBlur={commitTarget}
                onKeyDown={(event) => { if (event.key === "Enter") { event.currentTarget.blur(); } }}
                className="h-9 w-28 border-slate-200 bg-white text-right font-semibold tabular-nums"
                aria-label={t("目标套数")}
              />
            </label>
            <div className="grid gap-1 text-[11px] font-medium text-slate-500">
              <span>{t("库存范围")}</span>
              <div className="flex h-9 items-center gap-2 rounded-md border border-slate-200 bg-slate-50 px-3 text-sm font-semibold text-slate-700">
                <Warehouse className="size-4 text-primary" aria-hidden="true" />
                {t("量产仓库")}
              </div>
            </div>
            <Button type="button" variant="outline" size="sm" disabled={loading} onClick={() => { const target = commitTarget(); if (target !== null) void load(undefined, target); }} className="h-9 border-slate-200 bg-white text-slate-600">
              <RefreshCw className={cn("size-4", loading && "animate-spin")} aria-hidden="true" />
              {t("刷新")}
            </Button>
          </div>
        {targetError ? <p id="readiness-target-error" role="alert" className="mt-2 text-pretty text-xs text-rose-700">{targetError}</p> : null}
      </section>

      {error ? (
        <div role="alert" className="mb-3 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          <span className="flex items-center gap-2"><AlertCircle className="size-4" aria-hidden="true" />{error}</span>
          <Button type="button" variant="outline" size="sm" onClick={() => void load()} className="border-rose-200 bg-white text-rose-700">{t("重新加载")}</Button>
        </div>
      ) : null}

      {data && data.dataQuality.totalBomLines > 0 ? (
        <>
          <ReadinessRail data={data} />

          <section className="proc-readiness-metrics grid grid-cols-2 overflow-hidden rounded-xl border border-slate-200 bg-white">
            <MetricCard Icon={ShieldAlert} label={t("库存预警")} value={data.summary.warningMaterials} note={t("含缺货、目标缺口与数据异常")} actionLabel={`${t("库存预警")} · ${t("查看详情")}`} onClick={(opener) => openDrilldown("warning", opener)} tone={data.summary.warningMaterials > 0 ? "rose" : "emerald"} />
            <MetricCard Icon={Truck} label={t("在途物料")} value={data.summary.inTransitMaterials} note={t("量产仓库已确认在途")} actionLabel={`${t("在途物料")} · ${t("查看详情")}`} onClick={(opener) => openDrilldown("transit", opener)} tone="blue" />
            <MetricCard Icon={Target} label={t("瓶颈物料")} value={data.summary.bottleneckMaterials} note={t("决定当前可齐套上限")} actionLabel={`${t("瓶颈物料")} · ${t("查看详情")}`} onClick={(opener) => openDrilldown("bottleneck", opener)} tone={data.summary.bottleneckMaterials > 0 ? "amber" : "emerald"} />
            <MetricCard Icon={DatabaseZap} label={t("BOM 可核算率")} value={percent(data.dataQuality.bomCompleteness)} note={`${data.dataQuality.usableBomLines} / ${data.dataQuality.totalBomLines} ${t("条物料")}`} actionLabel={`${t("BOM 可核算率")} · ${t("查看详情")}`} onClick={(opener) => openDrilldown("bom", opener)} tone={data.dataQuality.provisional ? "amber" : "emerald"} />
          </section>

          {data.dataQuality.provisional ? (
            <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50/70 px-4 py-2.5 text-xs text-amber-800">
              <span className="flex min-w-0 items-center gap-2 text-pretty">
                <AlertCircle className="size-4 shrink-0" aria-hidden="true" />
                {t("当前结果为可核算范围估算：{invalid} 条 BOM 数据待完善，{unmatched} 条有效物料未匹配到量产仓库库存。", {
                  invalid: data.dataQuality.invalidBomLines,
                  unmatched: data.dataQuality.usableBomLines - data.dataQuality.inventoryMatchedLines,
                })}
              </span>
              {canViewMaterials ? (
                <button type="button" onClick={() => navigate(routePath("page:proc-materials", "/proc-materials"))} className="inline-flex shrink-0 items-center gap-1 font-semibold text-amber-900 hover:text-primary">
                  {t("检查物料主数据")}<ArrowRight className="size-3.5" aria-hidden="true" />
                </button>
              ) : null}
            </div>
          ) : null}

          <div className="proc-readiness-detail-grid grid min-w-0 gap-3">
            <section className="proc-readiness-detail flex min-h-0 min-w-0 flex-col overflow-hidden rounded-xl border border-slate-200 bg-white">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-4 py-3">
                <div>
                  <h2 className="text-sm font-bold text-slate-900">{t("{model} 物料齐套明细", { model: data.productLine })}</h2>
                  <p className="mt-0.5 text-xs text-slate-500">{t("按风险优先排列，库存与在途均来自量产仓库。")}</p>
                </div>
                <span className="text-xs text-slate-400">{t("显示 {count} 条", { count: filteredItems.length })}</span>
              </div>
              <div className="flex flex-wrap gap-2 border-b border-slate-100 bg-slate-50/50 px-4 py-3">
                <div className="relative min-w-0 flex-1 basis-56">
                  <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-slate-400" aria-hidden="true" />
                  <Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t("搜索物料编码、名称或规格")} className="h-9 border-slate-200 bg-white pl-9" aria-label={t("搜索物料齐套明细")} />
                </div>
                <Select value={category} onValueChange={setCategory}>
                  <SelectTrigger className="h-9 w-40 border-slate-200 bg-white" aria-label={t("按分类筛选")}><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">{t("全部分类")}</SelectItem>
                    {categories.map((item) => <SelectItem key={item} value={item}><AutoTranslatedText text={item} /></SelectItem>)}
                  </SelectContent>
                </Select>
                <Select value={status} onValueChange={setStatus}>
                  <SelectTrigger className="h-9 w-40 border-slate-200 bg-white" aria-label={t("按状态筛选")}><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">{t("全部状态")}</SelectItem>
                    <SelectItem value="warning">{t("仅看预警")}</SelectItem>
                    <SelectItem value="low">{t("低于安全库存")}</SelectItem>
                    <SelectItem value="shortage">{t("当前缺货")}</SelectItem>
                    <SelectItem value="gap">{t("目标有缺口")}</SelectItem>
                    <SelectItem value="unmatched">{t("未匹配 ERP")}</SelectItem>
                    <SelectItem value="data_missing">{t("BOM 待完善")}</SelectItem>
                    <SelectItem value="ready">{t("目标可覆盖")}</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {hasFilters ? <div className="border-b border-slate-100 px-4 py-2"><button type="button" onClick={clearFilters} className="text-xs font-semibold text-primary hover:underline">{t("清除筛选")}</button></div> : null}
              <div ref={tableScrollRef} tabIndex={0} role="region" aria-label={t("物料齐套明细，可横向滚动查看更多列")} className="proc-readiness-table-scroll min-h-0 min-w-0 flex-1 overflow-auto">
                {filteredItems.length === 0 ? (
                  <div className="flex flex-col items-center gap-3 px-4 py-10 text-center">
                    <p className="text-pretty text-sm text-slate-600">{t("没有符合当前条件的物料")}</p>
                    {hasFilters ? <Button variant="outline" size="sm" onClick={clearFilters}>{t("清除筛选")}</Button> : null}
                  </div>
                ) : <Table id="inventory-readiness-table" className="proc-readiness-table table-fixed" containerClassName="overflow-visible">
                  <colgroup><col className="w-64" /><col className="w-36" />{Array.from({ length: 7 }, (_, index) => <col key={index} className="w-28" />)}</colgroup>
                  <TableHeader className="sticky top-0 z-10 bg-background">
                    <TableRow className="border-slate-100 hover:bg-background">
                      <TableHead className="proc-readiness-identity text-xs font-semibold text-slate-500">{t("物料")}</TableHead>
                      <TableHead className="text-xs font-semibold text-slate-500">{t("状态")}</TableHead>
                      <TableHead className="text-right text-[11px] font-semibold text-slate-500">{t("单机用量")}</TableHead>
                      <TableHead className="text-right text-[11px] font-semibold text-slate-500">{t("现存量")}</TableHead>
                      <TableHead className="text-right text-[11px] font-semibold text-slate-500">{t("可用量")}</TableHead>
                      <TableHead className="text-right text-[11px] font-semibold text-slate-500">{t("在途")}</TableHead>
                      <TableHead className="text-right text-[11px] font-semibold text-slate-500">{t("当前可齐套")}</TableHead>
                      <TableHead className="text-right text-[11px] font-semibold text-slate-500">{t("到货后可齐套")}</TableHead>
                      <TableHead className="text-right text-[11px] font-semibold text-slate-500">{t("目标缺口")}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {pagedItems.map((item) => (
                      <TableRow key={item.id} onClick={(event) => openItem(item, event.currentTarget.querySelector("button"))} className="cursor-pointer border-slate-100 focus-visible:bg-accent focus-visible:outline-none hover:bg-background">
                        <TableCell className="proc-readiness-identity whitespace-normal">
                          <button type="button" onClick={(event) => { event.stopPropagation(); openItem(item, event.currentTarget); }} aria-label={t("查看物料：{name}", { name: item.name })} className="block w-full min-w-0 rounded text-left">
                            <span className="block break-words text-xs text-slate-500">{item.code || "—"}</span>
                            <span title={item.name} className="mt-1 line-clamp-2 break-words text-sm font-semibold text-slate-900"><AutoTranslatedText text={item.name} /></span>
                            <span title={[item.category, item.spec].filter(Boolean).join(" · ")} className="mt-1 line-clamp-2 break-words text-xs text-slate-500"><AutoTranslatedText text={item.category} />{item.spec ? <> · <AutoTranslatedText text={item.spec} /></> : null}</span>
                          </button>
                        </TableCell>
                        <TableCell><StatusBadge status={item.status} /></TableCell>
                        <TableCell className="text-right font-medium text-slate-700 tabular-nums">{item.qtyPer ? quantity(item.qtyPer) : "—"}</TableCell>
                        <TableCell className="text-right text-slate-600 tabular-nums">{quantity(item.stock)}</TableCell>
                        <TableCell className="text-right font-semibold text-slate-800 tabular-nums">{quantity(item.available)}</TableCell>
                        <TableCell className="text-right tabular-nums"><span className={item.inTransit > 0 ? "font-semibold text-primary" : "text-slate-400"}>{quantity(item.inTransit)}</span></TableCell>
                        <TableCell className="text-right font-bold text-slate-900 tabular-nums">{quantity(item.currentSets, 0)}</TableCell>
                        <TableCell className="text-right font-bold text-emerald-700 tabular-nums">{quantity(item.withTransitSets, 0)}</TableCell>
                        <TableCell className="text-right font-bold tabular-nums"><span className={item.gapAfterTransit > 0 ? "text-rose-600" : "text-slate-300"}>{quantity(item.gapAfterTransit)}</span></TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>}
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

            <aside className="proc-readiness-priorities flex min-h-0 min-w-0 flex-col overflow-hidden rounded-xl border border-slate-200 bg-white">
              <div className="border-b border-slate-100 px-4 py-3">
                <div className="flex items-center gap-2">
                  <span className="flex size-8 items-center justify-center rounded-lg bg-rose-50 text-rose-600"><ShieldAlert className="size-4" aria-hidden="true" /></span>
                  <div>
                    <h2 className="text-sm font-bold text-slate-900">{t("优先处理")}</h2>
                    <p className="mt-0.5 text-[11px] text-slate-500">{t("按到货后缺口从高到低")}</p>
                  </div>
                </div>
              </div>
              <div className="min-h-0 flex-1 divide-y divide-slate-100 overflow-auto">
                {bottlenecks.map((item, index) => (
                  <button key={item.id} type="button" onClick={(event) => openItem(item, event.currentTarget)} className="group flex w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-slate-50 focus-visible:bg-slate-50 focus-visible:outline-none">
                    <span className={cn("mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full text-[10px] font-bold tabular-nums", index < 3 ? "bg-rose-50 text-rose-600" : "bg-slate-100 text-slate-500")}>{index + 1}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-xs font-semibold text-slate-800"><AutoTranslatedText text={item.name} /></span>
                      <span className="mt-1 flex items-center justify-between gap-2 text-xs text-slate-500">
                        <span>{item.code || t("编码待补")}</span>
                        <span className="font-semibold text-rose-600 tabular-nums">{item.gapAfterTransit > 0 ? `${t("缺")} ${quantity(item.gapAfterTransit)} ${item.unit}` : t(STATUS_META[item.status].label)}</span>
                      </span>
                    </span>
                    <ArrowRight className="mt-1 size-3.5 shrink-0 text-slate-300 transition-transform group-hover:translate-x-0.5 group-hover:text-primary" aria-hidden="true" />
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
                <div className="flex items-center gap-2"><PackageCheck className="size-3.5 text-primary" aria-hidden="true" />{t("计算使用可用量，不以账面现存量替代。")}</div>
                <div className="mt-1 flex items-center gap-2"><Truck className="size-3.5 text-emerald-600" aria-hidden="true" />{t("在途只展示 ERP 已确认数量。")}</div>
              </div>
            </aside>
          </div>

          <div className="mt-3 flex flex-wrap items-center justify-between gap-2 px-1 pb-1 text-xs text-slate-500">
            <span>{t("数据来源：畅捷通 T+（只读）")} · {t("最后同步")}：{lastSync}</span>
            <span>{data.warehouse.matchedNames.length > 0 ? `${t("已匹配仓库")}：${data.warehouse.matchedNames.join(" / ")}` : t("未匹配到 ERP 量产仓库")}</span>
          </div>
        </>
      ) : data ? (
        <div className="flex min-h-64 flex-col items-center justify-center rounded-[14px] border border-slate-200 bg-white px-6 text-center shadow-[0_1px_2px_rgba(15,23,42,.03)]">
          <span className="flex size-12 items-center justify-center rounded-xl bg-accent text-primary"><Boxes className="size-6" aria-hidden="true" /></span>
          <h2 className="mt-4 text-base font-bold text-slate-900">{t("尚未找到 {model} BOM", { model: data.productLine || productLine })}</h2>
          <p className="mt-2 max-w-md text-sm leading-6 text-slate-500">{t("请先完成产品 BOM 初始化；库存齐套中心会按物料编码自动连接量产仓库的 ERP 库存。")}</p>
          {canViewMaterials ? <Button type="button" variant="outline" onClick={() => navigate(routePath("page:proc-materials", "/proc-materials"))} className="mt-4 border-slate-200 bg-white text-slate-700">{t("打开物料库")}</Button> : null}
        </div>
      ) : loading ? (
        <div className="flex min-h-64 items-center justify-center rounded-[14px] border border-slate-200 bg-white text-sm text-slate-500">
          <RefreshCw className="mr-2 size-4 animate-spin text-primary" aria-hidden="true" />{t("正在核算库存齐套情况…")}
        </div>
      ) : null}

      <Sheet open={Boolean(drilldown)} onOpenChange={(open) => { if (!open) setDrilldown(null); }}>
        <SheetContent onCloseAutoFocus={restoreSheetFocus} className="proc-horizon-drawer flex w-full flex-col gap-0 overflow-hidden border-slate-200 bg-background p-0 sm:max-w-xl">
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
                    className="group flex w-full cursor-pointer items-center gap-3 px-5 py-3 text-left transition-colors duration-200 hover:bg-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary/35"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="flex min-w-0 flex-wrap items-center gap-2">
                        <span className="shrink-0 rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-slate-600">{item.code || "—"}</span>
                        <span className="line-clamp-2 break-words text-sm font-semibold text-slate-900"><AutoTranslatedText text={item.name} /></span>
                      </span>
                      <span className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-500">
                        <AutoTranslatedText text={item.category} />
                        <StatusBadge status={item.status} />
                      </span>
                    </span>
                    <span className="shrink-0 text-right">
                      <span className={cn("block text-xs font-bold tabular-nums", drilldown === "transit" ? "text-primary" : "text-rose-600")}>
                        {drilldown === "transit"
                          ? `${t("在途")} ${quantity(item.inTransit)} ${item.unit}`
                          : item.gapAfterTransit > 0
                            ? `${t("缺")} ${quantity(item.gapAfterTransit)} ${item.unit}`
                            : t(STATUS_META[item.status].label)}
                      </span>
                    </span>
                    <ChevronRight className="size-4 shrink-0 text-slate-300 transition-transform duration-200 group-hover:translate-x-0.5 group-hover:text-primary motion-reduce:transition-none" aria-hidden="true" />
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
                <div className="shrink-0 border-t border-slate-200 bg-background p-4">
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
        <SheetContent onCloseAutoFocus={restoreSheetFocus} className="proc-horizon-drawer w-full gap-0 overflow-y-auto border-slate-200 bg-background p-0 sm:max-w-xl">
          {selected ? (
            <>
              <SheetHeader className="border-b border-slate-200 bg-white px-5 py-5 pr-12 text-left">
                <div className="mb-2 flex min-w-0 flex-wrap items-center gap-2"><StatusBadge status={selected.status} /><span className="min-w-0 max-w-full break-all rounded bg-slate-100 px-2 py-0.5 font-mono text-[11px] text-slate-600">{selected.code || t("编码待补")}</span></div>
                <SheetTitle className="min-w-0 break-words text-lg font-bold text-slate-900"><AutoTranslatedText text={selected.name} /></SheetTitle>
                <SheetDescription className="min-w-0 break-words text-xs text-slate-500"><AutoTranslatedText text={selected.category} />{selected.spec ? <> · <AutoTranslatedText text={selected.spec} /></> : null}</SheetDescription>
              </SheetHeader>
              <div className="space-y-3 p-4">
                <section className="rounded-xl border border-slate-200 bg-white p-4">
                  <h3 className="text-xs font-bold text-slate-900">{t("齐套贡献")}</h3>
                  <div className="mt-3 grid grid-cols-3 divide-x divide-slate-100 [&>div]:min-w-0 [&_p]:break-words">
                    <div className="pr-3"><p className="text-xs text-slate-500">{t("当前可齐套")}</p><p className="mt-1 text-xl font-bold text-primary tabular-nums">{quantity(selected.currentSets, 0)}</p></div>
                    <div className="px-3"><p className="text-xs text-slate-500">{t("到货后可齐套")}</p><p className="mt-1 text-xl font-bold text-emerald-700 tabular-nums">{quantity(selected.withTransitSets, 0)}</p></div>
                    <div className="pl-3"><p className="text-xs text-slate-500">{t("目标缺口")}</p><p className="mt-1 text-xl font-bold text-rose-600 tabular-nums">{quantity(selected.gapAfterTransit)}</p></div>
                  </div>
                </section>
                <section className="rounded-xl border border-slate-200 bg-white p-4">
                  <h3 className="text-xs font-bold text-slate-900">{t("数量口径")}</h3>
                  <dl className="mt-3 grid grid-cols-2 gap-x-6 gap-y-4 text-xs [&>div]:min-w-0 [&_dd]:break-words">
                    <div><dt className="text-slate-400">{t("单机用量")}</dt><dd className="mt-1 font-semibold text-slate-900 tabular-nums">{selected.qtyPer ? `${quantity(selected.qtyPer)} ${selected.unit}` : "—"}</dd></div>
                    <div><dt className="text-slate-400">{t("目标需求量")}</dt><dd className="mt-1 font-semibold text-slate-900 tabular-nums">{quantity(selected.targetDemand)} {selected.unit}</dd></div>
                    <div><dt className="text-slate-400">{t("量产仓库现存量")}</dt><dd className="mt-1 font-semibold text-slate-900 tabular-nums">{quantity(selected.stock)} {selected.unit}</dd></div>
                    <div><dt className="text-slate-400">{t("量产仓库可用量")}</dt><dd className="mt-1 font-semibold text-slate-900 tabular-nums">{quantity(selected.available)} {selected.unit}</dd></div>
                    <div><dt className="text-slate-400">{t("确认在途")}</dt><dd className="mt-1 font-semibold text-primary tabular-nums">{quantity(selected.inTransit)} {selected.unit}</dd></div>
                    <div><dt className="text-slate-400">{t("安全库存")}</dt><dd className="mt-1 font-semibold text-slate-900 tabular-nums">{quantity(selected.safeStock)} {selected.unit}</dd></div>
                  </dl>
                </section>
                {selected.issue ? (
                  <div role="note" className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs leading-5 text-amber-800">
                    {selected.issue === "missing_code" ? t("该 BOM 行缺少物料编码，无法连接 ERP 库存。") : selected.issue === "missing_qty" ? t("该 BOM 行单机用量为空或为 0，暂不参与齐套计算。") : t("ERP 量产仓库中未找到该物料编码的库存记录。")}
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
