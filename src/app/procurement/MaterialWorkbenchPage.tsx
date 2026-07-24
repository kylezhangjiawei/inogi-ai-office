// 物料库（资产视角）：统计条 + 树形物料表（大类→分类→物料，过滤时切扁平分页）+ 物料详情抽屉。
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router";
import { Boxes, ClipboardCheck, FolderTree, PackageCheck, Plus, RefreshCw, Sparkles, Truck, Upload } from "lucide-react";
import { useI18n } from "../lib/i18n";
import { daysFromToday, useProcurementData, type Material, type ProcStatus } from "./data";
import { PageHeader, StatCell, useProcCan } from "./components/common";
import { EMPTY_MATERIAL_FILTERS, MaterialTable, type MaterialFilters } from "./components/MaterialTable";
import { MaterialDetailDrawer } from "./components/MaterialDetailDrawer";
import { CategoryManageModal, ImportMaterialsModal, MaterialClassifyModal, MaterialFormModal, ReplenishModal, SafeStockModal, TplusConfigModal } from "./components/modals";

const TRANSIT: ProcStatus[] = ["in_transit", "partial_arrival"];

export function MaterialWorkbenchPage() {
  const { t } = useI18n();
  const navigate = useNavigate();
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
  // 写操作按钮按系统管理配置的操作码显隐
  const can = useProcCan();

  // 编辑落库刷新后，已打开的详情抽屉要换成最新对象（否则停留在改前数据）
  useEffect(() => {
    setDetail((cur) => (cur ? materials.find((m) => m.id === cur.id) ?? null : cur));
  }, [materials]);

  const stats = useMemo(() => {
    const active = tasks.filter((t) => !["completed", "cancelled"].includes(t.status));
    // 缺料 = 低于安全库存（设计口径）；未设安全库存的物料保留「零库存且被进行中任务引用」兜底
    const shortage = materials.filter((m) =>
      m.safeStock > 0
        ? m.stockQty < m.safeStock
        : m.stockQty === 0 && active.some((t) => t.materialName === m.name),
    ).length;
    const transitBatches = active.filter((t) => TRANSIT.includes(t.status)).length;
    const weekArrival = active.filter((t) => { const d = daysFromToday(t.expectedArrivalDate); return TRANSIT.includes(t.status) && d != null && d >= 0 && d <= 7; }).length;
    return { total: materials.length, pending: materials.filter((m) => m.reviewStatus === "pending").length, shortage, transitBatches, weekArrival };
  }, [materials, tasks]);

  return (
    <div className="mx-auto w-full max-w-[1600px] p-4">
      <PageHeader
        Icon={Boxes}
        badge={t("采购管理")}
        title={t("物料库 · 主数据与库存")}
        description={t("物料主数据与库存/在途资产视角：按大类与分类树形浏览，管理审核、缺料预警与历史价格。")}
        right={
          <div className="flex flex-wrap items-center gap-2">
            {can("proc-task:create") && <button type="button" onClick={() => setCreateOpen(true)} className="material-button-primary inline-flex items-center gap-1.5 px-3 py-2 text-sm"><Plus className="h-4 w-4" />{t("新增物料")}</button>}
            {can("material:import") && <button type="button" onClick={() => setImportOpen(true)} className="material-button-secondary inline-flex items-center gap-1.5 px-3 py-2 text-sm"><Upload className="h-4 w-4" />{t("批量导入")}</button>}
            {can("material:import") && <button type="button" onClick={() => setCatManageOpen(true)} className="material-button-secondary inline-flex items-center gap-1.5 px-3 py-2 text-sm"><FolderTree className="h-4 w-4" />{t("分类管理")}</button>}
            {can("material:import") && <button type="button" onClick={() => setClassifyOpen(true)} title={t("规则+AI 为未分类物料补分类")} className="material-button-secondary inline-flex items-center gap-1.5 px-3 py-2 text-sm"><Sparkles className="h-4 w-4" />{t("AI 分类")}</button>}
            {can("material:import") && <button type="button" onClick={() => setSafeStockOpen(true)} title={t("依据近 90 天采购用量初始化安全库存，点亮缺料预警")} className="material-button-secondary inline-flex items-center gap-1.5 px-3 py-2 text-sm"><PackageCheck className="h-4 w-4" />{t("安全库存")}</button>}
            {can("proc:sync-erp") && <button type="button" onClick={() => setTplusOpen(true)} title={t("畅捷通 T+ 凭据配置与手动同步")} className="material-button-secondary inline-flex items-center gap-1.5 px-3 py-2 text-sm"><RefreshCw className="h-4 w-4" />{t("T+ 集成")}</button>}
          </div>
        }
      />

      {/* 统计条：「待审核」点击切换审核过滤，审核动作在物料详情抽屉里做 */}
      <div className="mb-3 grid grid-cols-5 gap-3">
        <StatCell label={t("物料总数")} value={stats.total} Icon={Boxes} />
        <StatCell label={t("待审核")} value={stats.pending} tone={stats.pending > 0 ? "amber" : "slate"} badge={stats.pending > 0} Icon={ClipboardCheck} active={filters.reviewStatus === "pending"} onClick={() => setFilters((f) => ({ ...f, reviewStatus: f.reviewStatus === "pending" ? "" : "pending" }))} />
        <StatCell label={t("缺料预警")} value={stats.shortage} tone="red" badge={stats.shortage > 0} Icon={PackageCheck} onClick={() => setReplenishOpen(true)} />
        <StatCell label={t("在途批次")} value={stats.transitBatches} tone="indigo" Icon={Truck} />
        <StatCell label={t("本周到货批次")} value={stats.weekArrival} tone="emerald" Icon={PackageCheck} />
      </div>

      {error ? (
        <div className="material-card py-12 text-center text-sm text-red-500">{error}</div>
      ) : loading && materials.length === 0 ? (
        <div className="material-card py-12 text-center text-sm text-slate-400">{t("加载中")}…</div>
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
