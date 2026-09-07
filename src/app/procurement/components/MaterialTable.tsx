// 物料树形表格：大类（T+ 类别前缀）→ 分类 → 物料行；任一过滤激活时切扁平列表 + 分页。
import { Fragment, useDeferredValue, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clock3,
  Eye,
  FolderTree,
  HelpCircle,
  Link2Off,
  List,
  Search,
  X,
} from "lucide-react";
import { AutoTranslatedText } from "../../components/TranslatableText";
import { Button } from "../../components/ui/button";
import { Checkbox } from "../../components/ui/checkbox";
import { Input } from "../../components/ui/input";
import { Pagination, PaginationContent, PaginationItem } from "../../components/ui/pagination";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../components/ui/select";
import { ToggleGroup, ToggleGroupItem } from "../../components/ui/toggle-group";
import { Tooltip, TooltipContent, TooltipTrigger } from "../../components/ui/tooltip";
import { cn } from "../../components/ui/utils";
import { useI18n } from "../../lib/i18n";
import { useProductLines, type Material, type ProcurementTask } from "../data";
import { fmtMoney } from "./common";

const PAGE_SIZE = 50;

export interface MaterialFilters {
  keyword: string;
  productLine: string;
  reviewStatus: "" | "pending" | "approved" | "rejected";
  onlyStock: boolean;
}

export const EMPTY_MATERIAL_FILTERS: MaterialFilters = { keyword: "", productLine: "", reviewStatus: "", onlyStock: false };

type MaterialAggregate = { inTransit: number; taskCount: number };
export type MaterialSupplyRisk = "normal" | "low" | "shortage" | "unsynced";

/** 大类：按 T+ 类别名的「-」前缀分组（量产-R电子元器件 → 量产），无前缀的归整名。 */
function majorOf(category: string): string {
  const idx = category.indexOf("-");
  return idx > 0 ? category.slice(0, idx) : category || "未分类";
}

function materialCode(material: Material): string {
  return material.tpInventoryCode?.trim() || material.erpCode?.trim() || "";
}

/**
 * 保持 materialAggregates(tasks, m) 的匹配口径，但一次性建立索引，避免每渲染一行都扫描完整任务列表。
 * 存量任务没有 materialId 时仍按名称回落；同名主档会得到与旧逻辑一致的聚合结果。
 */
function buildMaterialAggregateIndex(materials: Material[], tasks: ProcurementTask[]) {
  const materialById = new Map(materials.map((material) => [material.id, material]));
  const materialsByName = new Map<string, Material[]>();
  const aggregates = new Map<string, MaterialAggregate>();

  for (const material of materials) {
    aggregates.set(material.id, { inTransit: 0, taskCount: 0 });
    const sameName = materialsByName.get(material.name) ?? [];
    sameName.push(material);
    materialsByName.set(material.name, sameName);
  }

  for (const task of tasks) {
    const targets = task.materialId
      ? (materialById.has(task.materialId) ? [materialById.get(task.materialId)!] : [])
      : (materialsByName.get(task.materialName) ?? []);
    const inTransit = task.status === "in_transit" || task.status === "partial_arrival"
      ? Math.max(0, task.quantity - task.arrivedQty)
      : 0;

    for (const material of targets) {
      const aggregate = aggregates.get(material.id)!;
      aggregate.taskCount += 1;
      aggregate.inTransit += inTransit;
    }
  }

  return aggregates;
}

export function materialSupplyRisk(material: Material, inTransit = material.inTransitQty) {
  if (!material.tpInventoryCode?.trim()) {
    return { tone: "unsynced" as const, label: "未关联 T+", detail: "库存口径不可用", Icon: Link2Off };
  }
  if (!material.inventorySyncedAt) {
    return { tone: "unsynced" as const, label: "待同步", detail: "等待库存同步", Icon: Clock3 };
  }
  if (material.availableQty <= 0) {
    return {
      tone: "shortage" as const,
      label: inTransit > 0 ? "缺货，有在途" : "缺货",
      detail: inTransit > 0 ? "无可用库存，已有补充在途" : "无可用库存",
      Icon: AlertTriangle,
    };
  }
  if (material.safeStock > 0 && material.availableQty < material.safeStock) {
    return { tone: "low" as const, label: "库存偏低", detail: "可用量低于安全库存", Icon: AlertTriangle };
  }
  return { tone: "normal" as const, label: "供应正常", detail: "可用量满足安全库存", Icon: CheckCircle2 };
}

const RISK_STYLE: Record<MaterialSupplyRisk, string> = {
  normal: "border-emerald-200 bg-emerald-50 text-emerald-700",
  low: "border-amber-200 bg-amber-50 text-amber-700",
  shortage: "border-rose-200 bg-rose-50 text-rose-700",
  unsynced: "border-slate-200 bg-slate-50 text-slate-600",
};

function ReviewPill({ status }: { status: Material["reviewStatus"] }) {
  const { t } = useI18n();
  const config = status === "pending"
    ? { label: "待审核", className: "border-amber-200 bg-amber-50 text-amber-700", Icon: Clock3 }
    : status === "rejected"
      ? { label: "已驳回", className: "border-rose-200 bg-rose-50 text-rose-700", Icon: AlertTriangle }
      : { label: "已通过", className: "border-emerald-200 bg-emerald-50 text-emerald-700", Icon: CheckCircle2 };
  const StatusIcon = config.Icon;
  return (
    <span className={cn("inline-flex items-center gap-1 whitespace-nowrap rounded-md border px-1.5 py-0.5 text-[10px] font-medium", config.className)}>
      <StatusIcon aria-hidden="true" className="size-3" />
      {t(config.label)}
    </span>
  );
}

export function MaterialTable({ materials, tasks, filters, onFiltersChange, onOpen }: {
  materials: Material[];
  tasks: ProcurementTask[];
  filters: MaterialFilters;
  onFiltersChange: (next: MaterialFilters) => void;
  onOpen: (material: Material) => void;
}) {
  const { t } = useI18n();
  const productLines = useProductLines();
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [viewMode, setViewMode] = useState("tree");
  const [categoryLimits, setCategoryLimits] = useState<Record<string, number>>({});
  const [pagination, setPagination] = useState({ filterKey: "", page: 1 });
  const resultsRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const nextMaterialFocusRef = useRef<HTMLButtonElement | null>(null);
  const nextMaterialIdRef = useRef<string | null>(null);
  const filterKey = JSON.stringify([filters.keyword, filters.productLine, filters.reviewStatus, filters.onlyStock, viewMode]);
  const page = pagination.filterKey === filterKey ? pagination.page : 1;
  // 页头统计也会改变筛选；记住新条件，避免切回旧条件时恢复到旧页码。
  if (pagination.filterKey !== filterKey) {
    setPagination({ filterKey, page: 1 });
  }
  const setPage = (nextPage: number) => setPagination({ filterKey, page: nextPage });

  const normalizedKeyword = filters.keyword.trim().toLowerCase();
  const deferredKeyword = useDeferredValue(normalizedKeyword);
  const filtersPending = deferredKeyword !== normalizedKeyword;
  const filterActive = Boolean(normalizedKeyword || filters.productLine || filters.reviewStatus || filters.onlyStock);
  const flatView = filterActive || viewMode === "list";

  const filtered = useMemo(() => materials.filter((material) =>
    (!deferredKeyword || `${material.name} ${material.spec} ${material.erpCode} ${material.tpInventoryCode ?? ""}`.toLowerCase().includes(deferredKeyword)) &&
    (!filters.productLine || material.productLine === filters.productLine) &&
    (!filters.reviewStatus || material.reviewStatus === filters.reviewStatus) &&
    (!filters.onlyStock || material.stockQty > 0)), [
    materials,
    deferredKeyword,
    filters.productLine,
    filters.reviewStatus,
    filters.onlyStock,
  ]);

  const aggregateByMaterialId = useMemo(
    () => buildMaterialAggregateIndex(materials, tasks),
    [materials, tasks],
  );

  // 树形分组：大类 → 分类 → 物料（无过滤时使用）
  const tree = useMemo(() => {
    const majors = new Map<string, Map<string, Material[]>>();
    for (const material of materials) {
      const major = majorOf(material.category || "未分类");
      const category = material.category || "未分类";
      const categories = majors.get(major) ?? new Map<string, Material[]>();
      const list = categories.get(category) ?? [];
      list.push(material);
      categories.set(category, list);
      majors.set(major, categories);
    }
    return [...majors.entries()]
      .map(([major, categories]) => ({
        major,
        count: [...categories.values()].reduce((sum, list) => sum + list.length, 0),
        cats: [...categories.entries()]
          .map(([category, list]) => ({
            cat: category,
            list: list.sort((a, b) => materialCode(a).localeCompare(materialCode(b), undefined, { numeric: true })),
          }))
          .sort((a, b) => b.list.length - a.list.length),
      }))
      .sort((a, b) => b.count - a.count);
  }, [materials]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const pageSafe = Math.min(page, totalPages);
  if (pagination.filterKey === filterKey && pagination.page !== pageSafe) {
    setPagination({ filterKey, page: pageSafe });
  }
  const pageRows = filtered.slice((pageSafe - 1) * PAGE_SIZE, pageSafe * PAGE_SIZE);
  const columnCount = flatView ? 13 : 12;

  useLayoutEffect(() => {
    resultsRef.current?.scrollTo({ top: 0 });
  }, [filterKey, pageSafe]);

  useLayoutEffect(() => {
    nextMaterialFocusRef.current?.focus();
    nextMaterialFocusRef.current = null;
    nextMaterialIdRef.current = null;
  }, [categoryLimits]);

  const reviewFilterLabel = filters.reviewStatus === "pending"
    ? t("待审核")
    : filters.reviewStatus === "approved"
      ? t("已通过")
      : filters.reviewStatus === "rejected"
        ? t("已驳回")
        : "";
  const activeFilterLabels = [
    normalizedKeyword ? { key: "keyword", label: `${t("关键词")}：${filters.keyword.trim()}` } : null,
    filters.productLine ? { key: "productLine", label: `${t("产品线")}：${t(filters.productLine)}` } : null,
    reviewFilterLabel ? { key: "reviewStatus", label: `${t("审核状态")}：${reviewFilterLabel}` } : null,
    filters.onlyStock ? { key: "onlyStock", label: t("只看有库存") } : null,
  ].filter((item): item is { key: string; label: string } => item != null);

  const setFilter = <K extends keyof MaterialFilters>(key: K, value: MaterialFilters[K]) => {
    onFiltersChange({ ...filters, [key]: value });
    setPage(1);
  };
  const clearFilters = () => {
    onFiltersChange(EMPTY_MATERIAL_FILTERS);
    setPage(1);
    searchRef.current?.focus();
  };
  const toggle = (key: string) => setExpanded((current) => {
    const next = new Set(current);
    if (next.has(key)) next.delete(key); else next.add(key);
    return next;
  });

  const th = "whitespace-nowrap px-3 py-2 text-left text-[11px] font-semibold text-slate-500";
  const td = "px-3 py-2 text-sm text-slate-700";
  const openMaterial = (m: Material) => onOpen(m);

  const materialRow = (material: Material, showCategory: boolean) => {
    const aggregate = aggregateByMaterialId.get(material.id) ?? { inTransit: 0, taskCount: 0 };
    const risk = materialSupplyRisk(material, aggregate.inTransit);
    const RiskIcon = risk.Icon;
    const inventoryReady = Boolean(material.tpInventoryCode?.trim() && material.inventorySyncedAt);
    return (
      <tr key={material.id} className="group border-t border-slate-100 hover:bg-background" data-supply-risk={risk.tone}>
        <td className={cn(td, "proc-horizon-material-identity sticky left-0 z-10 border-r border-slate-100 bg-white group-hover:bg-background")}>
          <button
            ref={(node) => { if (nextMaterialIdRef.current === material.id) nextMaterialFocusRef.current = node; }}
            type="button"
            title={material.name}
            onClick={() => openMaterial(material)}
            className="block w-full rounded-md text-left hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
          >
            <AutoTranslatedText className="line-clamp-2 break-words font-semibold text-slate-900" text={material.name} />
          </button>
          <span className="mt-1 block truncate font-mono text-xs tabular-nums text-slate-500" title={materialCode(material) || "—"}>
            {materialCode(material) || "—"}
          </span>
          {aggregate.taskCount > 0 && <span className="mt-0.5 block text-[11px] tabular-nums text-slate-500">{t("关联任务")} {aggregate.taskCount}</span>}
        </td>
        <td className={cn(td, "text-xs text-slate-600")} title={material.spec || "—"}>
          <AutoTranslatedText className="line-clamp-2 break-words" text={material.spec || "—"} />
        </td>
        <td className={cn(td, "whitespace-nowrap text-xs")}>{t(material.unit || "—")}</td>
        {showCategory && <td className={cn(td, "text-xs text-slate-500")} title={material.category || t("未分类")}><AutoTranslatedText className="block truncate" text={material.category || "未分类"} /></td>}
        <td className={cn(td, "text-xs")} title={t(material.productLine || "—")}><span className="block truncate">{t(material.productLine || "—")}</span></td>
        <td className={cn(td, "whitespace-nowrap text-right font-semibold tabular-nums text-slate-900")}>{material.stockQty.toLocaleString()}</td>
        <td className={cn(td, "whitespace-nowrap text-right font-semibold tabular-nums", inventoryReady ? "text-slate-900" : "text-slate-400")}>
          {inventoryReady ? material.availableQty.toLocaleString() : "—"}
        </td>
        <td className={cn(td, "whitespace-nowrap text-right tabular-nums text-slate-600")}>{material.safeStock.toLocaleString()}</td>
        <td className={cn(td, "whitespace-nowrap text-right tabular-nums", aggregate.inTransit > 0 ? "text-primary" : "text-slate-400")}>{aggregate.inTransit.toLocaleString()}</td>
        <td className={td}>
          <span title={t(risk.detail)} className={cn("inline-flex items-center gap-1 whitespace-nowrap rounded-md border px-1.5 py-0.5 text-[10px] font-medium", RISK_STYLE[risk.tone])}>
            <RiskIcon aria-hidden="true" className="size-3" />
            {t(risk.label)}
          </span>
        </td>
        <td className={cn(td, "whitespace-nowrap text-right text-xs tabular-nums")}>{material.latestPrice != null ? fmtMoney(material.latestPrice) : "—"}</td>
        <td className={td}><ReviewPill status={material.reviewStatus} /></td>
        <td className="sticky right-0 z-10 w-24 border-l border-slate-100 bg-white px-2 py-1.5 text-right group-hover:bg-background">
          <button
            type="button"
            onClick={() => openMaterial(material)}
            aria-label={t("查看物料详情：{name}", { name: material.name })}
            className="inline-flex h-10 items-center gap-1 rounded-lg px-2 text-xs font-medium text-primary hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
          >
            <Eye aria-hidden="true" className="size-3.5" />
            {t("详情")}
          </button>
        </td>
      </tr>
    );
  };

  const categoryRows = (key: string, list: Material[]) => {
    const limit = categoryLimits[key] ?? PAGE_SIZE;
    const remaining = Math.max(0, list.length - limit);
    return (
      <Fragment key={key}>
        {list.slice(0, limit).map((material) => materialRow(material, false))}
        {remaining > 0 && (
          <tr>
            <td colSpan={columnCount} className="border-t border-slate-100 p-0">
              <div className="sticky left-0 w-64 px-3 py-2">
                <button type="button" className="min-h-9 w-full rounded-lg border border-slate-200 px-2 py-1.5 text-xs font-medium text-primary hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
                  onClick={(event) => {
                    if (event.detail === 0) nextMaterialIdRef.current = list[limit]?.id ?? null;
                    setCategoryLimits((current) => ({ ...current, [key]: limit + PAGE_SIZE }));
                  }}>
                  {t("再显示 {count} 条 · 剩余 {remaining} 条", { count: Math.min(PAGE_SIZE, remaining), remaining })}
                </button>
              </div>
            </td>
          </tr>
        )}
      </Fragment>
    );
  };

  return (
    <div className="proc-horizon-material-results material-card flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
      <div className="proc-horizon-material-filters shrink-0 border-b border-slate-100 bg-slate-50/40 px-4 py-3">
        <div className="proc-horizon-material-filter-fields flex flex-wrap items-end gap-3">
          <label htmlFor="material-search-filter" className="block min-w-0 flex-1 basis-64">
            <span className="mb-1 block text-[11px] font-semibold text-slate-600">{t("搜索物料")}</span>
            <span className="relative block">
              <Search aria-hidden="true" className="pointer-events-none absolute left-2.5 top-1/2 z-10 size-4 -translate-y-1/2 text-slate-400" />
              <Input
                ref={searchRef}
                id="material-search-filter"
                aria-label={t("搜索物料")}
                value={filters.keyword}
                onChange={(event) => setFilter("keyword", event.target.value)}
                placeholder={t("名称 / 规格 / ERP 或 T+ 编码")}
                className="h-10 w-full rounded-lg border-slate-200 bg-white pl-8 pr-9 text-sm shadow-none placeholder:text-slate-400"
              />
              {filters.keyword && (
                <button
                  type="button"
                  aria-label={t("清空物料搜索")}
                  onClick={() => { setFilter("keyword", ""); searchRef.current?.focus(); }}
                  className="absolute right-1 top-1/2 flex size-8 -translate-y-1/2 items-center justify-center rounded-md text-slate-400 hover:bg-slate-100 hover:text-slate-600"
                >
                  <X aria-hidden="true" className="size-3.5" />
                </button>
              )}
            </span>
          </label>

          <div className="min-w-0 flex-1 basis-40">
            <span id="material-product-line-label" className="mb-1 block text-[11px] font-semibold text-slate-600">{t("产品线")}</span>
            <Select value={filters.productLine || "all"} onValueChange={(value) => setFilter("productLine", value === "all" ? "" : value)}>
              <SelectTrigger aria-labelledby="material-product-line-label" className="h-10 w-full rounded-lg border-slate-200 bg-white text-sm text-slate-700">
                <SelectValue placeholder={t("全部产品线")} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t("全部产品线")}</SelectItem>
                {productLines.map((productLine) => <SelectItem key={productLine} value={productLine}>{t(productLine)}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          <div className="min-w-0 flex-1 basis-40">
            <span id="material-review-status-label" className="mb-1 block text-[11px] font-semibold text-slate-600">{t("审核状态")}</span>
            <Select value={filters.reviewStatus || "all"} onValueChange={(value) => setFilter("reviewStatus", (value === "all" ? "" : value) as MaterialFilters["reviewStatus"])}>
              <SelectTrigger aria-labelledby="material-review-status-label" className="h-10 w-full rounded-lg border-slate-200 bg-white text-sm text-slate-700">
                <SelectValue placeholder={t("全部状态")} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t("全部状态")}</SelectItem>
                <SelectItem value="pending">{t("待审核")}</SelectItem>
                <SelectItem value="approved">{t("已通过")}</SelectItem>
                <SelectItem value="rejected">{t("已驳回")}</SelectItem>
              </SelectContent>
            </Select>
          </div>

        </div>

        <div className="mt-3 flex min-w-0 flex-wrap items-center gap-x-4 gap-y-2">
          {!filterActive && (
            <ToggleGroup type="single" value={viewMode} onValueChange={(value) => { if (value) setViewMode(value); }} aria-label={t("物料浏览方式")} className="rounded-lg border border-slate-200 bg-white p-0.5">
              <ToggleGroupItem value="tree" className="h-8 gap-1.5 px-2.5 text-xs data-[state=on]:bg-accent data-[state=on]:text-primary"><FolderTree aria-hidden="true" className="size-3.5" />{t("分类浏览")}</ToggleGroupItem>
              <ToggleGroupItem value="list" className="h-8 gap-1.5 px-2.5 text-xs data-[state=on]:bg-accent data-[state=on]:text-primary"><List aria-hidden="true" className="size-3.5" />{t("物料列表")}</ToggleGroupItem>
            </ToggleGroup>
          )}
          <label htmlFor="material-stock-filter" className="flex min-h-8 cursor-pointer items-center gap-2 text-sm text-slate-700">
            <Checkbox id="material-stock-filter" checked={filters.onlyStock} onCheckedChange={(value) => setFilter("onlyStock", value === true)} />
            <span className="whitespace-nowrap">{t("只看有库存")}</span>
          </label>

          <span aria-live="polite" aria-busy={filtersPending} className="ml-auto shrink-0 whitespace-nowrap text-right text-xs tabular-nums text-slate-500">
            {filtersPending ? t("筛选中") : filterActive ? t("{count} 条结果", { count: filtered.length }) : t("{count} 个物料", { count: materials.length })}
          </span>
        </div>

        {filterActive && (
          <div className="mt-2 flex flex-wrap items-center gap-1.5 border-t border-slate-100 pt-2" aria-label={t("已启用筛选")}>
            <span className="mr-0.5 text-[11px] font-semibold text-slate-500">{t("已启用筛选")}</span>
            {activeFilterLabels.map((item) => (
              <span key={item.key} title={item.label} className="max-w-64 truncate rounded-md border border-[var(--primary-soft-border)] bg-accent px-2 py-1 text-[11px] text-primary">
                {item.label}
              </span>
            ))}
            <button type="button" onClick={clearFilters} className="ml-1 inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium text-slate-600 hover:bg-slate-100 hover:text-primary">
              <X aria-hidden="true" className="size-3" />
              {t("清除全部")}
            </button>
          </div>
        )}
      </div>

      <div
        ref={resultsRef}
        className="proc-horizon-material-scroll min-h-0 flex-1 overflow-auto overscroll-contain focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary/30"
        role="region"
        aria-label={t("采购物料主数据，可横向滚动查看更多列")}
        tabIndex={0}
      >
        {filterActive && pageRows.length === 0 ? (
          <div className="flex min-h-48 flex-col items-center justify-center gap-3 px-4 py-8 text-center">
            <span className="text-pretty text-sm text-slate-500">{t("没有符合当前筛选条件的物料")}</span>
            <button type="button" onClick={clearFilters} className="material-button-secondary px-3 py-2 text-xs">{t("清除筛选并查看全部")}</button>
          </div>
        ) : (
        <table className="w-full min-w-[1480px] table-fixed border-separate border-spacing-0">
          <caption className="sr-only">{t("采购物料主数据、库存、可用量、安全库存与供应风险表")}</caption>
          <colgroup>
            <col className="w-64" />
            <col className="w-48" />
            <col className="w-16" />
            {flatView && <col className="w-40" />}
            <col className="w-32" />
            <col className="w-24" /><col className="w-24" /><col className="w-24" /><col className="w-24" />
            <col className="w-40" />
            <col className="w-28" />
            <col className="w-28" />
            <col className="w-24" />
          </colgroup>
          <thead className="sticky top-0 z-20 bg-slate-50">
            <tr>
              <th scope="col" className={cn(th, "sticky left-0 z-30 border-r border-slate-200 bg-slate-50")}>
                {t("物料名称")} / {t("物料编码")}
              </th>
              <th scope="col" className={th}>{t("规格型号")}</th>
              <th scope="col" className={th}>{t("单位")}</th>
              {flatView && <th scope="col" className={th}>{t("分类")}</th>}
              <th scope="col" className={th}>{t("产品线")}</th>
              <th scope="col" className={cn(th, "text-right")}>{t("现存量")}</th>
              <th scope="col" className={cn(th, "text-right")}>{t("可用量")}</th>
              <th scope="col" className={cn(th, "text-right")}>{t("安全库存")}</th>
              <th scope="col" className={cn(th, "text-right")}>
                <Tooltip>
                  <TooltipTrigger asChild><button type="button" className="inline-flex min-h-8 items-center gap-1 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30" aria-label={t("查看采购在途口径")}>
                    {t("采购在途")}<HelpCircle aria-hidden="true" className="size-3" />
                  </button></TooltipTrigger>
                  <TooltipContent className="max-w-64">{t("采购在途为系统采购任务的未到货数量，不含未关联任务的 ERP 在途。")}</TooltipContent>
                </Tooltip>
              </th>
              <th scope="col" className={th}>{t("供应风险")}</th>
              <th scope="col" className={cn(th, "text-right")}>{t("最新报价")}</th>
              <th scope="col" className={th}>{t("审核状态")}</th>
              <th scope="col" className={cn(th, "sticky right-0 z-30 w-24 border-l border-slate-200 bg-slate-50 text-right")}>{t("操作")}</th>
            </tr>
          </thead>
          <tbody>
            {flatView ? (
              pageRows.map((material) => materialRow(material, true))
            ) : tree.map((major) => (
              [
                <tr key={major.major} className="border-t border-slate-100 bg-slate-50/70 hover:bg-slate-100">
                  <td className="p-0 font-semibold text-slate-900" colSpan={columnCount}>
                    <div className="sticky left-0 w-64 px-3 py-2">
                    <button type="button" aria-expanded={expanded.has(major.major)} onClick={() => toggle(major.major)} className="flex min-h-8 w-full items-center gap-1.5 rounded-md text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30">
                      {expanded.has(major.major) ? <ChevronDown aria-hidden="true" className="size-4 text-slate-500" /> : <ChevronRight aria-hidden="true" className="size-4 text-slate-500" />}
                      <span className="min-w-0 flex-1" title={major.major}><AutoTranslatedText className="line-clamp-2 break-words" text={major.major} /></span>
                      <span className="shrink-0 rounded-md bg-slate-200/70 px-1.5 py-0.5 text-[11px] font-medium tabular-nums text-slate-600">{major.count}</span>
                    </button>
                    </div>
                  </td>
                </tr>,
                ...(expanded.has(major.major)
                  ? major.cats.length === 1 && major.cats[0].cat === major.major
                    ? [categoryRows(major.major, major.cats[0].list)]
                    : major.cats.flatMap((category) => [
                      <tr key={major.major + category.cat} className="border-t border-slate-100 hover:bg-slate-50">
                        <td className="p-0" colSpan={columnCount}>
                          <div className="sticky left-0 w-64 px-3 py-2">
                          <button type="button" aria-expanded={expanded.has(major.major + "::" + category.cat)} onClick={() => toggle(major.major + "::" + category.cat)} className="flex min-h-8 w-full items-center gap-1.5 rounded-md text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30" style={{ paddingLeft: 22 }}>
                            {expanded.has(major.major + "::" + category.cat) ? <ChevronDown aria-hidden="true" className="size-3.5 text-slate-400" /> : <ChevronRight aria-hidden="true" className="size-3.5 text-slate-400" />}
                            <span className="min-w-0 flex-1" title={category.cat}><AutoTranslatedText className="line-clamp-2 break-words font-medium text-slate-700" text={category.cat} /></span>
                            <span className="shrink-0 rounded-md bg-slate-100 px-1.5 py-0.5 text-[11px] tabular-nums text-slate-500">{category.list.length}</span>
                          </button>
                          </div>
                        </td>
                      </tr>,
                      ...(expanded.has(major.major + "::" + category.cat) ? [categoryRows(major.major + "::" + category.cat, category.list)] : []),
                    ])
                  : []),
              ]
            ))}
          </tbody>
        </table>
        )}
      </div>

      {flatView && filtered.length > PAGE_SIZE && (
        <div className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-2 border-t border-slate-100 px-4 py-2.5 text-sm">
          <span className="text-xs tabular-nums text-slate-500">{t("第 {page} / {total} 页", { page: pageSafe, total: totalPages })}</span>
          <Pagination className="mx-0 w-auto">
            <PaginationContent>
              <PaginationItem><Button type="button" variant="outline" size="sm" disabled={pageSafe <= 1} onClick={() => setPage(pageSafe - 1)} className="h-8 rounded-lg border-slate-200 text-xs text-slate-600">{t("上一页")}</Button></PaginationItem>
              <PaginationItem><Button type="button" variant="outline" size="sm" disabled={pageSafe >= totalPages} onClick={() => setPage(pageSafe + 1)} className="h-8 rounded-lg border-slate-200 text-xs text-slate-600">{t("下一页")}</Button></PaginationItem>
            </PaginationContent>
          </Pagination>
        </div>
      )}
    </div>
  );
}
