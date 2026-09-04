// 物料库（资产视角）：统计条 + 树形物料表（大类→分类→物料，过滤时切扁平分页）+ 物料详情抽屉。
import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { AlertCircle, Boxes, ClipboardCheck, FolderTree, PackageCheck, PackageOpen, Plus, RefreshCw, Sparkles, Truck, Upload } from "lucide-react";
import { useI18n } from "../lib/i18n";
import { daysFromToday, refreshProcurement, useProcurementData, type Material, type ProcStatus } from "./data";
import { Skeleton } from "../components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipTrigger } from "../components/ui/tooltip";
import { PageHeader, StatCell, useProcCan } from "./components/common";
import { EMPTY_MATERIAL_FILTERS, MaterialTable, type MaterialFilters } from "./components/MaterialTable";
import { MaterialDetailDrawer } from "./components/MaterialDetailDrawer";
import { CategoryManageModal, ImportMaterialsModal, MaterialClassifyModal, MaterialFormModal, ReplenishModal, SafeStockModal, TplusConfigModal } from "./components/modals";

const TRANSIT: ProcStatus[] = ["in_transit", "partial_arrival"];

function MaterialWorkbenchSkeleton({ label }: { label: string }) {
  return (
    <div role="status" aria-label={label} className="material-card flex min-h-0 flex-1 flex-col overflow-hidden">
      <span className="sr-only">{label}</span>
      <div className="grid grid-cols-1 gap-2 border-b border-slate-100 bg-slate-50/40 px-4 py-3 sm:grid-cols-4">
        <Skeleton className="h-12 sm:col-span-2" />
        <Skeleton className="h-12" />
        <Skeleton className="h-12" />
      </div>
      <div className="space-y-2 p-4">
        <Skeleton className="h-8 w-full" />
        {Array.from({ length: 7 }, (_, index) => <Skeleton key={index} className="h-10 w-full" />)}
      </div>
    </div>
  );
}

export function MaterialWorkbenchPage() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { tasks, materials, loading, error } = useProcurementData();
  const [detail, setDetail] = useState<Material | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [catManageOpen, setCatManageOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [tplusOpen, setTplusOpen] = useState(false);
  const [classifyOpen, setClassifyOpen] = useState(false);
  const [safeStockOpen, setSafeStockOpen] = useState(false);
  const [replenishOpen, setReplenishOpen] = useState(false);
  const [filters, setFilters] = useState<MaterialFilters>(EMPTY_MATERIAL_FILTERS);
  const [focusedMaterialCode, setFocusedMaterialCode] = useState("");
  // 写操作按钮按系统管理配置的操作码显隐
  const can = useProcCan();

  // 编辑落库刷新后，已打开的详情抽屉要换成最新对象（否则停留在改前数据）
  useEffect(() => {
    setDetail((cur) => (cur ? materials.find((m) => m.id === cur.id) ?? null : cur));
  }, [materials]);

  // 支持库存齐套中心按物料编码下钻：进入物料库后自动筛选并打开对应物料详情。
  useEffect(() => {
    const materialCode = searchParams.get("materialCode")?.trim() ?? "";
    if (!materialCode || focusedMaterialCode === materialCode) return;
    setFilters((current) => ({ ...current, keyword: materialCode }));
    const matched = materials.find((material) => (
      material.tpInventoryCode?.trim() === materialCode || material.erpCode?.trim() === materialCode
    ));
    if (!matched) return;
    setDetail(matched);
    setFocusedMaterialCode(materialCode);
  }, [focusedMaterialCode, materials, searchParams]);

  const stats = useMemo(() => {
    const active = tasks.filter((t) => !["completed", "cancelled"].includes(t.status));
    const activeMaterialNames = new Set(active.map((task) => task.materialName));
    // 缺料 = 低于安全库存（设计口径）；未设安全库存的物料保留「零库存且被进行中任务引用」兜底
    const shortage = materials.filter((m) =>
      m.safeStock > 0
        ? m.stockQty < m.safeStock
        : m.stockQty === 0 && activeMaterialNames.has(m.name),
    ).length;
    const transitBatches = active.filter((t) => TRANSIT.includes(t.status)).length;
    const weekArrival = active.filter((t) => { const d = daysFromToday(t.expectedArrivalDate); return TRANSIT.includes(t.status) && d != null && d >= 0 && d <= 7; }).length;
    return { total: materials.length, pending: materials.filter((m) => m.reviewStatus === "pending").length, shortage, transitBatches, weekArrival };
  }, [materials, tasks]);

  return (
    // h-full + flex 列：头部/统计固定，表格占剩余高度内部滚动，父级 main 不再出滚动条
    <div className="proc-horizon mx-auto flex h-full min-h-0 w-full max-w-[1600px] flex-col p-3 sm:p-4">
      <PageHeader
        Icon={Boxes}
        badge={t("供应链管理")}
        title={t("物料库 · 主数据与库存")}
        description={t("物料主数据与库存/在途资产视角：按大类与分类树形浏览，管理审核、缺料预警与历史价格。")}
        right={
          <div className="flex flex-wrap items-center gap-2">
            {can("proc-task:create") && <button type="button" onClick={() => setCreateOpen(true)} className="material-button-primary inline-flex items-center gap-1.5 px-3 py-2 text-sm"><Plus aria-hidden="true" className="size-4" />{t("新增物料")}</button>}
            {can("material:import") && <button type="button" onClick={() => setImportOpen(true)} className="material-button-secondary inline-flex items-center gap-1.5 px-3 py-2 text-sm"><Upload aria-hidden="true" className="size-4" />{t("批量导入")}</button>}
            {can("material:import") && <button type="button" onClick={() => setCatManageOpen(true)} className="material-button-secondary inline-flex items-center gap-1.5 px-3 py-2 text-sm"><FolderTree aria-hidden="true" className="size-4" />{t("分类管理")}</button>}
            {can("material:import") && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <button type="button" onClick={() => setClassifyOpen(true)} className="material-button-secondary inline-flex items-center gap-1.5 px-3 py-2 text-sm"><Sparkles aria-hidden="true" className="size-4" />{t("AI 分类")}</button>
                </TooltipTrigger>
                <TooltipContent side="bottom" className="max-w-60">{t("规则+AI 为未分类物料补分类")}</TooltipContent>
              </Tooltip>
            )}
            {can("material:import") && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <button type="button" onClick={() => setSafeStockOpen(true)} className="material-button-secondary inline-flex items-center gap-1.5 px-3 py-2 text-sm"><PackageCheck aria-hidden="true" className="size-4" />{t("安全库存")}</button>
                </TooltipTrigger>
                <TooltipContent side="bottom" className="max-w-60">{t("依据近 90 天采购用量初始化安全库存，点亮缺料预警")}</TooltipContent>
              </Tooltip>
            )}
            {can("proc:sync-erp") && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <button type="button" onClick={() => setTplusOpen(true)} className="material-button-secondary inline-flex items-center gap-1.5 px-3 py-2 text-sm"><RefreshCw aria-hidden="true" className="size-4" />{t("T+ 集成")}</button>
                </TooltipTrigger>
                <TooltipContent side="bottom" className="max-w-60">{t("畅捷通 T+ 凭据配置与手动同步")}</TooltipContent>
              </Tooltip>
            )}
          </div>
        }
      />

      {/* 统计条：「待审核」点击切换审核过滤，审核动作在物料详情抽屉里做 */}
      <div className="proc-horizon-kpi-grid proc-horizon-surface mb-3 grid grid-cols-2 gap-0 p-2 lg:grid-cols-5">
        <StatCell label={t("物料总数")} value={stats.total} Icon={Boxes} />
        <StatCell label={t("待审核")} value={stats.pending} tone={stats.pending > 0 ? "amber" : "slate"} badge={stats.pending > 0} Icon={ClipboardCheck} active={filters.reviewStatus === "pending"} onClick={() => setFilters((f) => ({ ...f, reviewStatus: f.reviewStatus === "pending" ? "" : "pending" }))} />
        <StatCell label={t("缺料预警")} value={stats.shortage} tone="red" badge={stats.shortage > 0} Icon={PackageCheck} onClick={() => setReplenishOpen(true)} />
        <StatCell label={t("在途批次")} value={stats.transitBatches} tone="indigo" Icon={Truck} />
        <StatCell label={t("本周到货批次")} value={stats.weekArrival} tone="emerald" Icon={PackageCheck} />
      </div>

      {error ? (
        <div role="alert" className="material-card flex flex-1 flex-col items-center justify-center gap-3 px-6 py-12 text-center">
          <span className="flex size-10 items-center justify-center rounded-lg bg-rose-50 text-rose-600"><AlertCircle aria-hidden="true" className="size-5" /></span>
          <div>
            <p className="text-balance text-sm font-semibold text-slate-900">{t("物料数据加载失败")}</p>
            <p className="mt-1 max-w-lg text-pretty text-xs text-rose-600">{error}</p>
          </div>
          <button type="button" onClick={() => void refreshProcurement()} className="material-button-secondary inline-flex items-center gap-1.5 px-3 py-2 text-xs"><RefreshCw aria-hidden="true" className="size-3.5" />{t("重新加载")}</button>
        </div>
      ) : loading && materials.length === 0 ? (
        <MaterialWorkbenchSkeleton label={t("正在加载物料主数据")} />
      ) : materials.length === 0 ? (
        <div className="material-card flex flex-1 flex-col items-center justify-center gap-3 py-14 text-center">
          <span className="flex size-10 items-center justify-center rounded-lg bg-slate-100 text-slate-500"><PackageOpen aria-hidden="true" className="size-5" /></span>
          <div>
            <p className="text-balance text-sm font-semibold text-slate-900">{t("物料库暂无数据")}</p>
            <p className="mt-1 text-pretty text-xs text-slate-500">{t("可新增单个物料、批量导入现有物料表，或刷新同步状态")}</p>
          </div>
          <div className="flex flex-wrap items-center justify-center gap-2">
            {can("proc-task:create") && <button type="button" onClick={() => setCreateOpen(true)} className="material-button-primary inline-flex items-center gap-1.5 px-3 py-2 text-xs"><Plus aria-hidden="true" className="size-4" />{t("新增物料")}</button>}
            {can("material:import") && <button type="button" onClick={() => setImportOpen(true)} className="material-button-secondary inline-flex items-center gap-1.5 px-3 py-2 text-xs"><Upload aria-hidden="true" className="size-4" />{t("批量导入")}</button>}
            <button type="button" onClick={() => void refreshProcurement()} className="material-button-secondary inline-flex items-center gap-1.5 px-3 py-2 text-xs"><RefreshCw aria-hidden="true" className="size-3.5" />{t("刷新数据")}</button>
          </div>
        </div>
      ) : (
        <MaterialTable materials={materials} tasks={tasks} filters={filters} onFiltersChange={setFilters} onOpen={setDetail} />
      )}

      {detail && <MaterialDetailDrawer material={detail} onClose={() => setDetail(null)} onOpenTask={(taskId) => navigate(`/proc-cockpit?task=${encodeURIComponent(taskId)}`)} />}
      {importOpen && <ImportMaterialsModal onClose={() => setImportOpen(false)} />}
      {createOpen && <MaterialFormModal onClose={() => setCreateOpen(false)} />}
      {tplusOpen && <TplusConfigModal onClose={() => setTplusOpen(false)} />}
      {catManageOpen && <CategoryManageModal onClose={() => setCatManageOpen(false)} />}
      {classifyOpen && <MaterialClassifyModal onClose={() => setClassifyOpen(false)} />}
      {safeStockOpen && <SafeStockModal onClose={() => setSafeStockOpen(false)} />}
      {replenishOpen && <ReplenishModal onClose={() => setReplenishOpen(false)} />}
    </div>
  );
}
