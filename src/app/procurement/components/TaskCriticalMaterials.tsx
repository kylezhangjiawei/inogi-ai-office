import { useDeferredValue, useId, useMemo, useState, type ReactNode } from "react";
import { AlertTriangle, PackageSearch, ShieldCheck, Truck, X } from "lucide-react";
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
import { cn } from "../../components/ui/utils";
import { useI18n } from "../../lib/i18n";
import {
  setProcTaskCriticalMaterials,
  type Material,
  type ProcTaskCriticalMaterialSetting,
  type ProcurementTask,
} from "../../lib/procurementApi";
import { refreshProcurement } from "../data";

export const MAX_TASK_CRITICAL_MATERIALS = 4;
const MAX_LEAD_TIME_DAYS = 36_500;
const CONFIG_ROW_LIMIT = 60;

type StockTone = "normal" | "low" | "shortage" | "missing";

function hasSyncedTplusInventory(material: Material) {
  return Boolean(material.tpInventoryCode?.trim() && material.inventorySyncedAt);
}
const syncedMaterialIndexCache = new WeakMap<Material[], Map<string, Material>>();

function syncedMaterialIndex(materials: Material[]) {
  const cached = syncedMaterialIndexCache.get(materials);
  if (cached) return cached;
  const index = new Map(
    materials
      .filter(hasSyncedTplusInventory)
      .map((material) => [material.id, material]),
  );
  syncedMaterialIndexCache.set(materials, index);
  return index;
}


function formatQuantity(value: number) {
  return value.toLocaleString("zh-CN", { maximumFractionDigits: 3 });
}

function stockState(material: Material): { tone: StockTone; label: string } {
  if (!material.tpInventoryCode) return { tone: "missing", label: "未关联 T+" };
  if (!material.inventorySyncedAt) return { tone: "missing", label: "数据待同步" };
  if (material.availableQty <= 0) return { tone: "shortage", label: "缺货" };
  if (material.safeStock > 0 && material.availableQty < material.safeStock) {
    return { tone: "low", label: "库存偏低" };
  }
  return { tone: "normal", label: "库存正常" };
}

const TONE_CLASS: Record<StockTone, { badge: string; value: string; icon: typeof ShieldCheck }> = {
  normal: { badge: "border-emerald-200 bg-emerald-50 text-emerald-700", value: "text-emerald-700", icon: ShieldCheck },
  low: { badge: "border-amber-200 bg-amber-50 text-amber-700", value: "text-amber-700", icon: AlertTriangle },
  shortage: { badge: "border-rose-200 bg-rose-50 text-rose-700", value: "text-rose-700", icon: AlertTriangle },
  missing: { badge: "border-slate-200 bg-slate-100 text-slate-600", value: "text-slate-600", icon: PackageSearch },
};

export function TaskCriticalMaterials({
  task,
  materials,
  compact = false,
}: {
  task: ProcurementTask;
  materials: Material[];
  compact?: boolean;
}) {
  const { t } = useI18n();
  const configured = useMemo(() => {
    if (!task.criticalMaterials?.length) return [];
    const materialById = syncedMaterialIndex(materials);
    return task.criticalMaterials.flatMap((setting) => {
      const material = materialById.get(setting.materialId);
      return material ? [{ setting, material }] : [];
    });
  }, [materials, task.criticalMaterials]);

  if (configured.length === 0) return null;

  if (compact) {
    const states = configured.map(({ material }) => stockState(material));
    const shortages = states.filter((state) => state.tone === "shortage").length;
    const lows = states.filter((state) => state.tone === "low").length;
    const missing = states.filter((state) => state.tone === "missing").length;
    const tone: StockTone = shortages > 0 ? "shortage" : lows > 0 ? "low" : missing > 0 ? "missing" : "normal";
    const ToneIcon = TONE_CLASS[tone].icon;
    const summary = shortages > 0
      ? t("{count} 项缺货", { count: shortages })
      : lows > 0
        ? t("{count} 项库存偏低", { count: lows })
        : missing > 0
          ? t("{count} 项待同步", { count: missing })
          : t("库存正常");

    return (
      <div className="proc-horizon-critical-summary flex min-w-0 items-center gap-2 border-y border-slate-100 py-2 text-[10px]">
        <PackageSearch aria-hidden="true" className="size-3.5 shrink-0 text-primary" />
        <span className="font-semibold text-slate-500">{t("重点库存")}</span>
        <span className="rounded-full bg-slate-100 px-1.5 py-0.5 tabular-nums text-slate-500">{configured.length}</span>
        <span className={cn("ml-auto inline-flex shrink-0 items-center gap-1 font-semibold", TONE_CLASS[tone].value)}>
          <ToneIcon aria-hidden="true" className="size-3" />{summary}
        </span>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50/70 px-2.5 py-2">
      <div className="flex items-center gap-1.5 text-[10px] font-semibold text-slate-500">
        <PackageSearch aria-hidden="true" className="size-3.5 text-primary" />
        {t("重点库存")}
        <span className="rounded-full bg-white px-1.5 py-0.5 tabular-nums text-slate-500">
          {configured.length}
        </span>
      </div>

      <div className="mt-1.5 space-y-1">
        {configured.map(({ material, setting }) => {
          const state = stockState(material);
          const tone = TONE_CLASS[state.tone];
          const StateIcon = tone.icon;
          const hasInventory = Boolean(material.tpInventoryCode && material.inventorySyncedAt);
          return (
            <div key={material.id} className="flex min-w-0 items-center gap-1.5 rounded-md border border-slate-100 bg-white px-2 py-1.5 text-[10px]" data-stock-state={state.tone}>
              <span className="min-w-0 flex-1 truncate font-semibold text-slate-700">
                <AutoTranslatedText as="span" text={material.name} />
              </span>
              <span className={cn("inline-flex shrink-0 items-center gap-0.5 rounded border px-1 py-0.5 font-semibold", tone.badge)}>
                <StateIcon aria-hidden="true" className="size-2.5" />
                {t(state.label)}
              </span>
              <span className={cn("shrink-0 tabular-nums", tone.value)}>
                {t("可用")} {hasInventory ? formatQuantity(material.availableQty) : "—"}
              </span>
              <span className="hidden shrink-0 tabular-nums text-slate-500 sm:inline">
                {t("安全")} {formatQuantity(material.safeStock)}
              </span>
              <span className="hidden shrink-0 tabular-nums text-slate-500 xl:inline">
                <Truck aria-hidden="true" className="mr-0.5 inline size-2.5" />{t("在途")} {formatQuantity(material.inTransitQty)}
              </span>
              {setting.leadTimeDays != null ? (
                <span className="shrink-0 tabular-nums text-slate-400">
                  {setting.leadTimeDays}{t("天")}
                </span>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function TaskCriticalMaterialsEditor({
  task,
  materials,
  children,
}: {
  task: ProcurementTask;
  materials: Material[];
  children: (controls: { openEditor: () => void }) => ReactNode;
}) {
  const { t } = useI18n();
  const [editorOpen, setEditorOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [leadTimeById, setLeadTimeById] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const searchId = useId();
  const normalizedSearch = search.trim().toLowerCase();
  const deferredSearch = useDeferredValue(normalizedSearch);
  const searchPending = deferredSearch !== normalizedSearch;

  const configRows = useMemo(() => {
    if (!editorOpen) return [];
    const materialById = syncedMaterialIndex(materials);
    const keyword = deferredSearch;
    const selectedSet = new Set(selectedIds);
    const selected = selectedIds.flatMap((id) => {
      const material = materialById.get(id);
      return material ? [material] : [];
    });
    const matches: Material[] = [];
    for (const material of materials) {
      if (!hasSyncedTplusInventory(material)) continue;
      if (selectedSet.has(material.id)) continue;
      const searchable = `${material.name} ${material.spec} ${material.erpCode} ${material.tpInventoryCode ?? ""}`.toLowerCase();
      if (keyword && !searchable.includes(keyword)) continue;
      if (matches.length < CONFIG_ROW_LIMIT) matches.push(material);
    }
    return [...selected, ...matches];
  }, [deferredSearch, editorOpen, materials, selectedIds]);

  const openEditor = () => {
    const materialById = syncedMaterialIndex(materials);
    const settings = (task.criticalMaterials ?? []).filter((setting) => (
      materialById.has(setting.materialId)
    ));
    setSelectedIds(settings.map((setting) => setting.materialId));
    setLeadTimeById(Object.fromEntries(settings.map((setting) => [
      setting.materialId,
      setting.leadTimeDays == null ? "" : String(setting.leadTimeDays),
    ])));
    setSearch("");
    setSaveError(null);
    setEditorOpen(true);
  };

  const toggleMaterial = (materialId: string, checked: boolean) => {
    if (checked && selectedIds.length >= MAX_TASK_CRITICAL_MATERIALS) {
      setSaveError(t("每个任务最多设置 {count} 个重点物料", { count: MAX_TASK_CRITICAL_MATERIALS }));
      return;
    }
    setSaveError(null);
    setSelectedIds((current) => checked
      ? [...current, materialId]
      : current.filter((id) => id !== materialId));
  };

  const saveConfig = async () => {
    const items: ProcTaskCriticalMaterialSetting[] = [];
    for (const materialId of selectedIds) {
      const rawLeadTime = leadTimeById[materialId]?.trim() ?? "";
      const parsedLeadTime = rawLeadTime === "" ? undefined : Number(rawLeadTime);
      if (parsedLeadTime != null && (!Number.isInteger(parsedLeadTime) || parsedLeadTime < 0 || parsedLeadTime > MAX_LEAD_TIME_DAYS)) {
        setSaveError(t("采购周期必须是 0 到 {count} 之间的整数", { count: MAX_LEAD_TIME_DAYS }));
        return;
      }
      items.push({
        materialId,
        leadTimeDays: parsedLeadTime == null ? undefined : Math.floor(parsedLeadTime),
      });
    }

    setSaving(true);
    setSaveError(null);
    try {
      await setProcTaskCriticalMaterials(task.id, items);
      await refreshProcurement();
      setEditorOpen(false);
      toast.success(t("任务重点物料库存设置已保存"));
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : t("任务重点物料库存设置保存失败"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      {children({ openEditor })}

      <Dialog open={editorOpen} onOpenChange={(open) => { if (!saving) setEditorOpen(open); }}>
        <DialogContent
          className="horizon-theme horizon-portal proc-horizon-overlay flex max-h-[85dvh] max-w-2xl flex-col overflow-hidden"
          onClick={(event) => event.stopPropagation()}
        >
          <DialogHeader>
            <DialogTitle className="text-balance">{t("设置任务重点物料库存")}</DialogTitle>
            <DialogDescription className="text-pretty">
              {t("仅作用于任务 {code}；最多选择 {count} 个核心长周期物料。", {
                code: task.code,
                count: MAX_TASK_CRITICAL_MATERIALS,
              })}
              {t("仅展示已关联 T+ 且完成过库存同步的物料；库存为 0 的缺货物料仍可选择。")}
            </DialogDescription>
          </DialogHeader>

          <div className="grid grid-cols-[minmax(0,1fr)_auto] items-end gap-3">
            <label htmlFor={searchId} className="min-w-0">
              <span className="mb-1 block text-[11px] font-semibold text-slate-600">{t("搜索重点物料")}</span>
              <span className="relative block">
                <Input
                  id={searchId}
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder={t("物料名称、规格、ERP 或 T+ 编码")}
                  className="pr-9"
                />
                {search && (
                  <button
                    type="button"
                    aria-label={t("清空重点物料搜索")}
                    onClick={() => setSearch("")}
                    className="absolute right-1 top-1/2 flex size-8 -translate-y-1/2 items-center justify-center rounded-md text-slate-400 hover:bg-slate-100 hover:text-slate-600"
                  >
                    <X aria-hidden="true" className="size-3.5" />
                  </button>
                )}
              </span>
            </label>
            <span aria-live="polite" aria-busy={searchPending} className="mb-2 shrink-0 text-xs font-semibold tabular-nums text-slate-500">
              {searchPending ? t("筛选中") : `${t("已选")} ${selectedIds.length}/${MAX_TASK_CRITICAL_MATERIALS}`}
            </span>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto rounded-xl border border-slate-200">
            <div className="sticky top-0 grid grid-cols-[minmax(0,1fr)_110px] gap-3 border-b border-slate-200 bg-slate-50 px-3 py-2 text-[11px] font-semibold text-slate-500">
              <span>{t("重点物料")}</span>
              <span>{t("采购周期（天）")}</span>
            </div>
            {configRows.map((material) => {
              const checked = selectedIds.includes(material.id);
              return (
                <div key={material.id} className="grid grid-cols-[minmax(0,1fr)_110px] items-center gap-3 border-b border-slate-100 px-3 py-2 last:border-b-0">
                  <label className="flex min-w-0 cursor-pointer items-center gap-2">
                    <Checkbox
                      checked={checked}
                      onCheckedChange={(value) => toggleMaterial(material.id, value === true)}
                    />
                    <span className="min-w-0">
                      <AutoTranslatedText as="span" text={material.name} className="block truncate text-sm font-semibold text-slate-800" />
                      <AutoTranslatedText
                        as="span"
                        text={[material.spec, material.erpCode].filter(Boolean).join(" · ") || "—"}
                        className="block truncate text-[11px] text-slate-400"
                      />
                    </span>
                  </label>
                  <Input
                    value={leadTimeById[material.id] ?? ""}
                    type="number"
                    max={MAX_LEAD_TIME_DAYS}
                    onChange={(event) => setLeadTimeById((current) => ({
                      ...current,
                      [material.id]: event.target.value,
                    }))}
                    inputMode="numeric"
                    min={0}
                    disabled={!checked}
                    placeholder="—"
                    aria-label={t("{material}采购周期", { material: material.name })}
                    className="h-8 tabular-nums"
                  />
                </div>
              );
            })}
            {!searchPending && configRows.length === 0 ? (
              <div className="flex flex-col items-center gap-3 px-4 py-10 text-center">
                <p className="max-w-md text-pretty text-sm text-slate-500">
                  {t(search.trim()
                    ? "没有匹配的物料，可清除搜索查看全部候选"
                    : "没有可配置的物料，请先到物料库完成 T+ 关联和库存同步")}
                </p>
                {search.trim() && (
                  <button type="button" onClick={() => setSearch("")} className="material-button-secondary px-3 py-2 text-xs">
                    {t("清除搜索")}
                  </button>
                )}
              </div>
            ) : null}
          </div>

          {saveError ? (
            <p role="alert" className="text-pretty text-xs text-rose-600">{saveError}</p>
          ) : null}

          <DialogFooter>
            <button
              type="button"
              onClick={() => setEditorOpen(false)}
              disabled={saving}
              className="material-button-secondary px-4 py-2 text-sm"
            >
              {t("取消")}
            </button>
            <button
              type="button"
              onClick={() => void saveConfig()}
              disabled={saving}
              className="material-button-primary px-4 py-2 text-sm disabled:cursor-wait disabled:opacity-60"
            >
              {saving ? t("保存中") : t("保存设置")}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
