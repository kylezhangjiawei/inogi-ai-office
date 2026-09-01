import { useMemo, useState } from "react";
import { AlertTriangle, ChevronLeft, ChevronRight, PackageSearch, Search, Settings2, ShieldCheck } from "lucide-react";
import { toast } from "sonner";

import { AutoTranslatedText } from "../../components/TranslatableText";
import { Checkbox } from "../../components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../../components/ui/dialog";
import { Input } from "../../components/ui/input";
import { Button } from "../../components/ui/button";
import { Pagination, PaginationContent, PaginationItem } from "../../components/ui/pagination";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../components/ui/select";
import { ToggleGroup, ToggleGroupItem } from "../../components/ui/toggle-group";
import { cn } from "../../components/ui/utils";
import { useI18n } from "../../lib/i18n";
import type { Material, ProcTaskTreeNode } from "../../lib/procurementApi";

type CoreMaterialCandidate = {
  material: Material;
  paths: string[];
};

type InventoryTone = "normal" | "low" | "shortage";
type InventoryFilter = "all" | InventoryTone;

const INVENTORY_PAGE_SIZE = 8;
const CONFIG_PAGE_SIZE = 10;

const TONE_STYLE: Record<InventoryTone, { label: string; badge: string; value: string }> = {
  normal: { label: "正常", badge: "bg-emerald-50 text-emerald-700", value: "text-emerald-700" },
  low: { label: "偏低", badge: "bg-amber-50 text-amber-700", value: "text-amber-700" },
  shortage: { label: "缺货", badge: "bg-rose-50 text-rose-700", value: "text-rose-700" },
};

function inventoryTone(material: Material): InventoryTone {
  if (material.availableQty <= 0) return "shortage";
  if (material.safeStock > 0 && material.availableQty < material.safeStock) return "low";
  return "normal";
}

function formatQuantity(value: number) {
  return value.toLocaleString("zh-CN", { maximumFractionDigits: 3 });
}

function collectLeafMaterialPaths(
  nodes: ProcTaskTreeNode[],
  parents: string[],
  pathsByMaterialId: Map<string, Set<string>>,
) {
  for (const node of nodes) {
    const path = [...parents, node.name];
    if (node.children.length === 0 && node.materialId) {
      const paths = pathsByMaterialId.get(node.materialId) ?? new Set<string>();
      paths.add(path.join(" / "));
      pathsByMaterialId.set(node.materialId, paths);
    }
    if (node.children.length > 0) collectLeafMaterialPaths(node.children, path, pathsByMaterialId);
  }
}

function coreSuggestionScore({ material, paths }: CoreMaterialCandidate) {
  const text = `${material.name} ${paths.join(" ")}`;
  if (/(210|310).*(三通|两通)?电磁阀|(三通|两通)电磁阀/.test(text) && !/(线束|密封圈|堵头|阀座)/.test(text)) return 100;
  if (/主控板|主电路板/.test(text)) return 95;
  if (/(^|[】\s])压缩机[（(]/.test(text)) return 90;
  if (/分子筛原料/.test(text)) return 85;
  if (/分子筛筒/.test(text) && !/(密封圈|硅胶塞)/.test(text)) return 80;
  if (/动力电芯|常温锂电池/.test(text)) return 75;
  return 0;
}

function CoreInventoryTable({ items, preview = false }: { items: CoreMaterialCandidate[]; preview?: boolean }) {
  const { t } = useI18n();
  return (
    <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
      <div className="min-w-[860px]">
        <div className="grid grid-cols-[minmax(260px,1fr)_100px_100px_100px_100px_84px] gap-3 border-b border-slate-200 bg-slate-50 px-4 py-2 text-[11px] font-semibold text-slate-500">
          <span>{t("核心配件 / 子系统路径")}</span>
          <span className="text-right">{t("可用库存")}</span>
          <span className="text-right">{t("现存数量")}</span>
          <span className="text-right">{t("在途数量")}</span>
          <span className="text-right">{t("安全库存")}</span>
          <span className="text-center">{t("状态")}</span>
        </div>
        {items.map(({ material, paths }) => {
          const tone = inventoryTone(material);
          const style = TONE_STYLE[tone];
          return (
            <div key={material.id} className="grid grid-cols-[minmax(260px,1fr)_100px_100px_100px_100px_84px] items-center gap-3 border-b border-slate-100 px-4 py-3 last:border-b-0">
              <div className="min-w-0">
                <div className="flex min-w-0 items-center gap-2">
                  <AutoTranslatedText as="span" text={material.name} className="truncate text-sm font-semibold text-slate-800" />
                  {preview ? <span className="shrink-0 rounded bg-[#eef3ff] px-1.5 py-0.5 text-[10px] font-semibold text-[#002fa7]">{t("建议")}</span> : null}
                  <span className="shrink-0 text-[11px] text-slate-400">{material.spec || material.tpInventoryCode}</span>
                </div>
                <AutoTranslatedText as="p" text={paths.join("；")} className="mt-0.5 truncate text-[11px] text-slate-400" />
              </div>
              <span className={cn("text-right text-sm font-bold tabular-nums", style.value)}>{formatQuantity(material.availableQty)}</span>
              <span className="text-right text-xs tabular-nums text-slate-600">{formatQuantity(material.stockQty)}</span>
              <span className="text-right text-xs tabular-nums text-slate-600">{formatQuantity(material.inTransitQty)}</span>
              <span className="text-right text-xs tabular-nums text-slate-600">{formatQuantity(material.safeStock)}</span>
              <span className={cn("justify-self-center rounded-full px-2 py-1 text-[11px] font-semibold", style.badge)}>{t(style.label)}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function InventoryFilterBar({
  search,
  tone,
  resultCount,
  totalCount,
  onSearchChange,
  onToneChange,
}: {
  search: string;
  tone: InventoryFilter;
  resultCount: number;
  totalCount: number;
  onSearchChange: (value: string) => void;
  onToneChange: (value: InventoryFilter) => void;
}) {
  const { t } = useI18n();
  const filters: Array<{ value: InventoryFilter; label: string }> = [
    { value: "all", label: "全部" },
    { value: "shortage", label: "缺货" },
    { value: "low", label: "偏低" },
    { value: "normal", label: "正常" },
  ];
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200 bg-white p-2">
      <div className="relative min-w-52 flex-1 sm:max-w-sm">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
        <Input
          value={search}
          onChange={(event) => onSearchChange(event.target.value)}
          aria-label={t("搜索核心配件库存")}
          placeholder={t("搜索名称、编码或子系统路径")}
          className="h-8 pl-9 text-xs"
        />
      </div>
      <ToggleGroup type="single" value={tone} onValueChange={(value) => { if (value) onToneChange(value as InventoryFilter); }} aria-label={t("库存状态筛选")} className="flex flex-wrap gap-1">
        {filters.map((filter) => (
          <ToggleGroupItem
            key={filter.value}
            value={filter.value}
            size="sm"
            className="h-8 flex-none rounded-lg px-2.5 text-xs font-semibold text-slate-500 data-[state=on]:bg-[#eef3ff] data-[state=on]:text-[#002fa7]"
          >
            {t(filter.label)}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
      <span className="shrink-0 px-1 text-xs tabular-nums text-slate-500">{resultCount}/{totalCount}</span>
    </div>
  );
}

function InventoryPagination({
  page,
  totalPages,
  totalItems,
  onPageChange,
}: {
  page: number;
  totalPages: number;
  totalItems: number;
  onPageChange: (page: number) => void;
}) {
  const { t } = useI18n();
  return (
    <div className="flex items-center justify-between gap-3 px-1 py-1 text-xs text-slate-500">
      <span className="tabular-nums">{t("共 {count} 项", { count: totalItems })}</span>
      <Pagination className="mx-0 w-auto">
        <PaginationContent>
        <PaginationItem>
        <Button
          type="button"
          variant="outline"
          size="icon"
          disabled={page <= 1}
          onClick={() => onPageChange(page - 1)}
          aria-label={t("上一页")}
          className="size-7 rounded-lg border-slate-200 text-slate-500 hover:border-[#002fa7]/25 hover:text-[#002fa7]"
        >
          <ChevronLeft className="size-4" />
        </Button>
        </PaginationItem>
        <span className="min-w-20 text-center font-semibold tabular-nums text-slate-600">
          {t("第 {page}/{total} 页", { page, total: totalPages })}
        </span>
        <PaginationItem>
        <Button
          type="button"
          variant="outline"
          size="icon"
          disabled={page >= totalPages}
          onClick={() => onPageChange(page + 1)}
          aria-label={t("下一页")}
          className="size-7 rounded-lg border-slate-200 text-slate-500 hover:border-[#002fa7]/25 hover:text-[#002fa7]"
        >
          <ChevronRight className="size-4" />
        </Button>
        </PaginationItem>
        </PaginationContent>
      </Pagination>
    </div>
  );
}

export function CoreMaterialsPanorama({
  productId,
  productName,
  roots,
  materials,
  configuredIds,
  maxItems,
  configLoading,
  configError,
  canManage,
  onRetryConfig,
  onSave,
}: {
  productId: string;
  productName: string;
  roots: ProcTaskTreeNode[];
  materials: Material[];
  configuredIds: string[];
  maxItems: number;
  configLoading: boolean;
  configError: string | null;
  canManage: boolean;
  onRetryConfig: () => void;
  onSave: (productId: string, materialIds: string[]) => Promise<void>;
}) {
  const { t } = useI18n();
  const [editorOpen, setEditorOpen] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [search, setSearch] = useState("");
  const [configTone, setConfigTone] = useState<InventoryFilter>("all");
  const [configSystem, setConfigSystem] = useState("all");
  const [configPage, setConfigPage] = useState(1);
  const [inventorySearch, setInventorySearch] = useState("");
  const [inventoryFilter, setInventoryFilter] = useState<InventoryFilter>("all");
  const [inventoryPage, setInventoryPage] = useState(1);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const selectedIdSet = useMemo(() => new Set(selectedIds), [selectedIds]);

  const candidates = useMemo(() => {
    const pathsByMaterialId = new Map<string, Set<string>>();
    collectLeafMaterialPaths(roots, [], pathsByMaterialId);
    const materialById = new Map(materials.map((material) => [material.id, material]));
    const result: CoreMaterialCandidate[] = [];
    for (const [materialId, paths] of pathsByMaterialId) {
      const material = materialById.get(materialId);
      if (!material?.tpInventoryCode?.trim() || !material.inventorySyncedAt) continue;
      result.push({ material, paths: [...paths].sort((a, b) => a.localeCompare(b, "zh-CN")) });
    }
    return result.sort((a, b) => a.material.name.localeCompare(b.material.name, "zh-CN"));
  }, [materials, roots]);

  const candidateById = useMemo(
    () => new Map(candidates.map((candidate) => [candidate.material.id, candidate])),
    [candidates],
  );
  const configured = useMemo(
    () => configuredIds.flatMap((id) => {
      const candidate = candidateById.get(id);
      return candidate ? [candidate] : [];
    }),
    [candidateById, configuredIds],
  );
  const suggestions = useMemo(
    () => candidates
      .map((candidate) => ({ candidate, score: coreSuggestionScore(candidate) }))
      .filter(({ score }) => score > 0)
      .sort((a, b) => b.score - a.score || a.candidate.material.name.localeCompare(b.candidate.material.name, "zh-CN"))
      .slice(0, maxItems)
      .map(({ candidate }) => candidate),
    [candidates, maxItems],
  );
  const previewItems = suggestions.length > 0 ? suggestions : candidates.slice(0, Math.min(8, maxItems));
  const inventorySource = configured.length > 0 ? configured : previewItems;
  const filteredInventoryItems = useMemo(() => {
    const keyword = inventorySearch.trim().toLowerCase();
    return inventorySource.filter(({ material, paths }) => {
      if (inventoryFilter !== "all" && inventoryTone(material) !== inventoryFilter) return false;
      if (!keyword) return true;
      return `${material.name} ${material.spec} ${material.erpCode} ${material.tpInventoryCode} ${paths.join(" ")}`
        .toLowerCase()
        .includes(keyword);
    });
  }, [inventoryFilter, inventorySearch, inventorySource]);
  const inventoryTotalPages = Math.max(1, Math.ceil(filteredInventoryItems.length / INVENTORY_PAGE_SIZE));
  const currentInventoryPage = Math.min(inventoryPage, inventoryTotalPages);
  const pagedInventoryItems = filteredInventoryItems.slice(
    (currentInventoryPage - 1) * INVENTORY_PAGE_SIZE,
    currentInventoryPage * INVENTORY_PAGE_SIZE,
  );
  const summary = useMemo(() => {
    let shortage = 0;
    let low = 0;
    for (const candidate of configured) {
      const tone = inventoryTone(candidate.material);
      if (tone === "shortage") shortage += 1;
      if (tone === "low") low += 1;
    }
    return { shortage, low };
  }, [configured]);

  const configSystems = useMemo(() => Array.from(new Set(
    candidates.flatMap(({ paths }) => paths.map((path) => path.split(" / ")[0]).filter(Boolean)),
  )).sort((a, b) => a.localeCompare(b, "zh-CN")), [candidates]);

  const filteredConfigRows = useMemo(() => {
    if (!editorOpen) return [];
    const keyword = search.trim().toLowerCase();
    const matched = candidates.filter(({ material, paths }) => {
      if (configTone !== "all" && inventoryTone(material) !== configTone) return false;
      if (configSystem !== "all" && !paths.some((path) => path.split(" / ")[0] === configSystem)) return false;
      if (!keyword) return true;
      return `${material.name} ${material.spec} ${material.erpCode} ${material.tpInventoryCode} ${paths.join(" ")}`
        .toLowerCase()
        .includes(keyword);
    });
    return matched.sort((a, b) => a.material.name.localeCompare(b.material.name, "zh-CN"));
  }, [candidates, configSystem, configTone, editorOpen, search]);
  const configTotalPages = Math.max(1, Math.ceil(filteredConfigRows.length / CONFIG_PAGE_SIZE));
  const currentConfigPage = Math.min(configPage, configTotalPages);
  const configRows = filteredConfigRows.slice(
    (currentConfigPage - 1) * CONFIG_PAGE_SIZE,
    currentConfigPage * CONFIG_PAGE_SIZE,
  );

  const openEditor = (useSuggestions = false) => {
    const initialItems = configured.length > 0
      ? configured
      : useSuggestions
        ? previewItems
        : [];
    setSelectedIds(initialItems.map(({ material }) => material.id));
    setSearch("");
    setConfigTone("all");
    setConfigSystem("all");
    setConfigPage(1);
    setSaveError(null);
    setEditorOpen(true);
  };

  const toggleMaterial = (materialId: string, checked: boolean) => {
    if (checked && !selectedIdSet.has(materialId) && selectedIds.length >= maxItems) {
      setSaveError(t("每个产品最多配置 {count} 个核心配件", { count: maxItems }));
      return;
    }
    setSaveError(null);
    setSelectedIds((current) => {
      if (!checked) return current.filter((id) => id !== materialId);
      if (selectedIdSet.has(materialId)) return current;
      return [...current, materialId];
    });
  };

  const currentPageIds = configRows.map(({ material }) => material.id);
  const currentPageSelectedCount = currentPageIds.filter((id) => selectedIdSet.has(id)).length;
  const allCurrentPageSelected = currentPageIds.length > 0 && currentPageSelectedCount === currentPageIds.length;
  const someCurrentPageSelected = currentPageSelectedCount > 0 && !allCurrentPageSelected;

  const toggleCurrentPage = (checked: boolean) => {
    setSaveError(null);
    if (!checked) {
      const pageIdSet = new Set(currentPageIds);
      setSelectedIds((current) => current.filter((id) => !pageIdSet.has(id)));
      return;
    }
    const unselectedPageIds = currentPageIds.filter((id) => !selectedIdSet.has(id));
    const remaining = Math.max(0, maxItems - selectedIds.length);
    const acceptedIds = unselectedPageIds.slice(0, remaining);
    if (acceptedIds.length < unselectedPageIds.length) {
      setSaveError(t("最多选择 {count} 项，本页还有 {remaining} 项未选中", {
        count: maxItems,
        remaining: unselectedPageIds.length - acceptedIds.length,
      }));
    }
    setSelectedIds((current) => [...current, ...acceptedIds.filter((id) => !selectedIdSet.has(id))]);
  };

  const hasInventoryFilters = Boolean(inventorySearch.trim() || inventoryFilter !== "all");
  const clearInventoryFilters = () => {
    setInventorySearch("");
    setInventoryFilter("all");
    setInventoryPage(1);
  };
  const hasConfigFilters = Boolean(search.trim() || configSystem !== "all" || configTone !== "all");
  const clearConfigFilters = () => {
    setSearch("");
    setConfigSystem("all");
    setConfigTone("all");
    setConfigPage(1);
  };

  const saveConfig = async () => {
    setSaving(true);
    setSaveError(null);
    try {
      await onSave(productId, selectedIds);
      setEditorOpen(false);
      toast.success(t("核心配件配置已保存"));
    } catch (cause) {
      setSaveError(cause instanceof Error ? cause.message : t("核心配件配置保存失败"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 px-5 py-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-balance text-base font-bold text-slate-900">{t("核心长周期配件")}</h2>
            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold tabular-nums text-slate-600">
              {t("已配置")} {configured.length}/{maxItems}
            </span>
            {summary.shortage > 0 ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-rose-50 px-2 py-0.5 text-xs font-semibold tabular-nums text-rose-700">
                <AlertTriangle className="size-3" />
                {t("缺货")} {summary.shortage}
              </span>
            ) : null}
            {summary.low > 0 ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-xs font-semibold tabular-nums text-amber-700">
                <AlertTriangle className="size-3" />
                {t("偏低")} {summary.low}
              </span>
            ) : null}
          </div>
          <p className="mt-1 text-pretty text-xs text-slate-500">
            {t("{product} · 仅展示从子系统叶子物料中选出的核心配件，同一 T+ 物料只计算一次。", { product: productName })}
          </p>
        </div>
        {canManage && configured.length > 0 && !configLoading && !configError ? (
          <button type="button" onClick={() => openEditor()} className="material-button-secondary inline-flex items-center gap-1.5 px-3 py-1.5 text-xs">
            <Settings2 className="size-3.5" />
            {t("配置核心配件")}
          </button>
        ) : null}
      </div>

      <div className="min-h-0 flex-1 overflow-auto p-5">
        {configLoading ? (
          <div className="space-y-2 rounded-xl border border-slate-200 p-4" aria-label={t("正在加载核心配件配置")}>
            {[0, 1, 2].map((item) => (
              <div key={item} className="grid grid-cols-[minmax(220px,1fr)_100px_100px_100px] gap-3 rounded-lg bg-slate-50 px-3 py-3">
                <span className="h-4 w-48 animate-pulse rounded bg-slate-200 motion-reduce:animate-none" />
                <span className="h-4 animate-pulse rounded bg-slate-200 motion-reduce:animate-none" />
                <span className="h-4 animate-pulse rounded bg-slate-200 motion-reduce:animate-none" />
                <span className="h-4 animate-pulse rounded bg-slate-200 motion-reduce:animate-none" />
              </div>
            ))}
          </div>
        ) : configError ? (
          <div className="flex min-h-64 flex-col items-center justify-center rounded-xl border border-dashed border-rose-200 bg-rose-50 px-4 text-center">
            <AlertTriangle className="mb-3 size-8 text-rose-400" />
            <p className="text-pretty text-sm font-semibold text-rose-700">{configError}</p>
            <button type="button" onClick={onRetryConfig} className="material-button-secondary mt-4 px-4 py-2 text-sm">{t("重新加载")}</button>
          </div>
        ) : configured.length === 0 ? (
          <div className="space-y-4">
            <section className="rounded-xl border border-slate-200 bg-slate-50 p-4">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <PackageSearch className="size-5 text-[#002fa7]" />
                    <h3 className="text-balance text-sm font-bold text-slate-800">{t("当前还没有正式监控项")}</h3>
                  </div>
                  <p className="mt-1 max-w-2xl text-pretty text-xs leading-5 text-slate-500">
                    {t("系统已经找到 {count} 个有真实 T+ 库存的叶子物料。下面先展示领导关注方向的建议项，确认保存后才会成为正式核心配件。", { count: candidates.length })}
                  </p>
                </div>
                {canManage && previewItems.length > 0 ? (
                  <button type="button" onClick={() => openEditor(true)} className="material-button-primary inline-flex items-center gap-1.5 px-4 py-2 text-sm">
                    <Settings2 className="size-4" />
                    {t("确认建议项")}
                  </button>
                ) : null}
              </div>

              <div className="mt-4 grid gap-2 sm:grid-cols-3">
                {[
                  { step: "1", title: t("系统找数据"), detail: t("仅取当前产品的子系统叶子物料，并要求已同步 T+ 库存。") },
                  { step: "2", title: t("负责人确认"), detail: t("从建议项中增删，最终保留制作周期长的核心配件，最多 {count} 项。", { count: maxItems }) },
                  { step: "3", title: t("持续看数量"), detail: t("正式列表持续显示可用、现存、在途、安全库存和异常状态。") },
                ].map((item) => (
                  <div key={item.step} className="flex gap-3 rounded-lg border border-slate-200 bg-white p-3">
                    <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-[#eef3ff] text-xs font-bold tabular-nums text-[#002fa7]">{item.step}</span>
                    <span className="min-w-0">
                      <span className="block text-xs font-bold text-slate-700">{item.title}</span>
                      <span className="mt-0.5 block text-pretty text-[11px] leading-4 text-slate-500">{item.detail}</span>
                    </span>
                  </div>
                ))}
              </div>
            </section>

            {previewItems.length > 0 ? (
              <section>
                <div className="mb-2 flex flex-wrap items-end justify-between gap-2">
                  <div>
                    <h3 className="text-balance text-sm font-bold text-slate-800">{t("建议关注项预览")}</h3>
                    <p className="mt-0.5 text-pretty text-[11px] text-slate-500">
                      {t("依据压缩机、主控板、分子筛、电磁阀和动力电芯等关注方向，从真实叶子物料中初步识别；这不是自动保存结果。")}
                    </p>
                  </div>
                  <span className="rounded-full bg-[#eef3ff] px-2 py-1 text-xs font-semibold tabular-nums text-[#002fa7]">{previewItems.length} {t("项待确认")}</span>
                </div>
                <div className="space-y-2">
                  <InventoryFilterBar
                    search={inventorySearch}
                    tone={inventoryFilter}
                    resultCount={filteredInventoryItems.length}
                    totalCount={inventorySource.length}
                    onSearchChange={(value) => { setInventorySearch(value); setInventoryPage(1); }}
                    onToneChange={(value) => { setInventoryFilter(value); setInventoryPage(1); }}
                  />
                  {pagedInventoryItems.length > 0 ? (
                    <div className="overflow-x-auto">
                      <CoreInventoryTable items={pagedInventoryItems} preview />
                    </div>
                  ) : (
                    <div className="flex flex-col items-center rounded-xl border border-dashed border-slate-200 bg-slate-50 px-4 py-8 text-center text-sm text-slate-500">
                      <p>{t("没有符合当前筛选条件的核心配件")}</p>
                      {hasInventoryFilters ? <button type="button" onClick={clearInventoryFilters} className="material-button-secondary mt-3 px-3 py-1.5 text-xs">{t("清除筛选")}</button> : null}
                    </div>
                  )}
                  <InventoryPagination
                    page={currentInventoryPage}
                    totalPages={inventoryTotalPages}
                    totalItems={filteredInventoryItems.length}
                    onPageChange={setInventoryPage}
                  />
                </div>
              </section>
            ) : (
              <div className="flex min-h-40 flex-col items-center justify-center rounded-xl border border-dashed border-slate-200 bg-slate-50 px-4 text-center">
                <AlertTriangle className="mb-2 size-7 text-amber-400" />
                <p className="text-sm font-semibold text-slate-600">{t("还没有可预览的库存叶子物料")}</p>
                <p className="mt-1 text-pretty text-xs text-slate-400">{t("请先完成叶子节点物料关联及 T+ 库存同步。")}</p>
              </div>
            )}
          </div>
        ) : (
          <div className="space-y-2">
            <InventoryFilterBar
              search={inventorySearch}
              tone={inventoryFilter}
              resultCount={filteredInventoryItems.length}
              totalCount={inventorySource.length}
              onSearchChange={(value) => { setInventorySearch(value); setInventoryPage(1); }}
              onToneChange={(value) => { setInventoryFilter(value); setInventoryPage(1); }}
            />
            {pagedInventoryItems.length > 0 ? (
              <div className="overflow-x-auto">
                <CoreInventoryTable items={pagedInventoryItems} />
              </div>
            ) : (
              <div className="flex flex-col items-center rounded-xl border border-dashed border-slate-200 bg-slate-50 px-4 py-8 text-center text-sm text-slate-500">
                <p>{t("没有符合当前筛选条件的核心配件")}</p>
                {hasInventoryFilters ? <button type="button" onClick={clearInventoryFilters} className="material-button-secondary mt-3 px-3 py-1.5 text-xs">{t("清除筛选")}</button> : null}
              </div>
            )}
            <InventoryPagination
              page={currentInventoryPage}
              totalPages={inventoryTotalPages}
              totalItems={filteredInventoryItems.length}
              onPageChange={setInventoryPage}
            />
          </div>
        )}
      </div>

      <Dialog open={editorOpen} onOpenChange={(open) => { if (!saving) setEditorOpen(open); }}>
        <DialogContent className="horizon-theme horizon-portal proc-horizon-overlay flex max-h-[85dvh] max-w-3xl flex-col overflow-hidden">
          <DialogHeader>
            <DialogTitle className="text-balance">{t("配置 {product} 核心配件", { product: productName })}</DialogTitle>
            <DialogDescription className="text-pretty">
              {t("候选仅来自当前产品子系统中已关联 T+ 且完成库存同步的叶子物料，最多选择 {count} 项。", { count: maxItems })}
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-wrap items-center gap-2">
            <div className="relative min-w-52 flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
              <Input
                value={search}
                onChange={(event) => { setSearch(event.target.value); setConfigPage(1); }}
                aria-label={t("搜索核心配件候选")}
                placeholder={t("搜索配件名称、规格、编码或子系统")}
                className="h-9 pl-9 text-xs"
              />
            </div>
            <Select value={configSystem} onValueChange={(value) => { setConfigSystem(value); setConfigPage(1); }}>
              <SelectTrigger aria-label={t("按子系统筛选")} className="h-9 w-40 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t("全部子系统")}</SelectItem>
                {configSystems.map((system) => <SelectItem key={system} value={system}>{system}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={configTone} onValueChange={(value) => { setConfigTone(value as InventoryFilter); setConfigPage(1); }}>
              <SelectTrigger aria-label={t("按库存状态筛选")} className="h-9 w-28 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t("全部状态")}</SelectItem>
                <SelectItem value="shortage">{t("缺货")}</SelectItem>
                <SelectItem value="low">{t("偏低")}</SelectItem>
                <SelectItem value="normal">{t("正常")}</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
            <label className={cn("flex items-center gap-2 text-xs font-semibold", currentPageIds.length > 0 ? "cursor-pointer text-slate-700" : "cursor-not-allowed text-slate-400")}>
              <Checkbox
                checked={allCurrentPageSelected ? true : someCurrentPageSelected ? "indeterminate" : false}
                disabled={currentPageIds.length === 0}
                onCheckedChange={(value) => toggleCurrentPage(value === true)}
              />
              {t("全选当前页")}
              <span className="font-normal tabular-nums text-slate-500">({currentPageIds.length})</span>
            </label>
            <div className="flex items-center gap-3">
              <button
                type="button"
                disabled={selectedIds.length === 0}
                onClick={() => { setSelectedIds([]); setSaveError(null); }}
                className="text-xs font-semibold text-slate-500 hover:text-slate-800 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {t("清空已选")}
              </button>
              <span className="text-xs font-semibold tabular-nums text-slate-600">{t("已选")} {selectedIds.length}/{maxItems}</span>
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto rounded-xl border border-slate-200">
            {configRows.map(({ material, paths }) => {
              const checked = selectedIdSet.has(material.id);
              const tone = inventoryTone(material);
              const style = TONE_STYLE[tone];
              return (
                <label key={material.id} className="flex cursor-pointer items-center gap-3 border-b border-slate-100 px-3 py-2.5 last:border-b-0 hover:bg-slate-50">
                  <Checkbox checked={checked} onCheckedChange={(value) => toggleMaterial(material.id, value === true)} />
                  <span className="min-w-0 flex-1">
                    <span className="flex min-w-0 items-center gap-2">
                      <AutoTranslatedText as="span" text={material.name} className="truncate text-sm font-semibold text-slate-800" />
                      <span className="shrink-0 text-[11px] text-slate-400">{material.spec || material.tpInventoryCode}</span>
                    </span>
                    <AutoTranslatedText as="span" text={paths.join("；")} className="block truncate text-[11px] text-slate-400" />
                  </span>
                  <span className={cn("shrink-0 text-xs font-bold tabular-nums", style.value)}>{t("可用")} {formatQuantity(material.availableQty)}</span>
                  <span className={cn("shrink-0 rounded-full px-2 py-1 text-[11px] font-semibold", style.badge)}>{t(style.label)}</span>
                </label>
              );
            })}
            {filteredConfigRows.length === 0 ? (
              <div className="flex flex-col items-center px-4 py-10 text-center">
                {candidates.length === 0 ? <AlertTriangle className="mb-2 size-6 text-amber-400" /> : <ShieldCheck className="mb-2 size-6 text-slate-300" />}
                <p className="text-sm font-medium text-slate-500">
                  {t(candidates.length === 0 ? "没有符合条件的子系统叶子物料" : "没有匹配的核心配件候选")}
                </p>
                {candidates.length === 0 ? (
                  <p className="mt-1 text-pretty text-xs text-slate-400">{t("请先完成叶子节点物料关联及 T+ 库存同步。")}</p>
                ) : hasConfigFilters ? (
                  <button type="button" onClick={clearConfigFilters} className="material-button-secondary mt-3 px-3 py-1.5 text-xs">{t("清除筛选")}</button>
                ) : null}
              </div>
            ) : null}
          </div>

          <InventoryPagination
            page={currentConfigPage}
            totalPages={configTotalPages}
            totalItems={filteredConfigRows.length}
            onPageChange={setConfigPage}
          />

          {saveError ? <p role="alert" className="text-pretty text-xs text-rose-600">{saveError}</p> : null}

          <DialogFooter>
            <button type="button" onClick={() => setEditorOpen(false)} disabled={saving} className="material-button-secondary px-4 py-2 text-sm">{t("取消")}</button>
            <button type="button" onClick={() => void saveConfig()} disabled={saving} className="material-button-primary px-4 py-2 text-sm disabled:cursor-wait disabled:opacity-60">
              {saving ? t("保存中…") : t("保存配置")}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
