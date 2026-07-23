// 采购工作台（资产视角 · 物料库）：统计条 + 产品线Tab + 分类总览网格 + 物料瀑布流 + 物料详情抽屉。
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { Boxes, FolderTree, PackageCheck, Plus, RefreshCw, Search, Truck, Upload } from "lucide-react";
import { cn } from "../components/ui/utils";
import { AutoTranslatedText } from "../components/TranslatableText";
import { useI18n } from "../lib/i18n";
import { PROC_PRODUCT_LINES, daysFromToday, useProcurementData, type Material, type ProcStatus } from "./data";
import { PageHeader, StatCell, stageToast, useProcCan } from "./components/common";
import { MaterialCard } from "./components/MaterialCard";
import { MaterialDetailDrawer } from "./components/MaterialDetailDrawer";
import { PriceHistoryModal } from "./components/PriceHistoryModal";
import { CategoryManageModal, ImportMaterialsModal, MaterialFormModal } from "./components/modals";

const TRANSIT: ProcStatus[] = ["in_transit", "partial_arrival"];

export function MaterialWorkbenchPage() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const { tasks, materials, loading, error } = useProcurementData();
  const [productLine, setProductLine] = useState<(typeof PROC_PRODUCT_LINES)[number] | "all">("all");
  const [category, setCategory] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [detail, setDetail] = useState<Material | null>(null);
  const [history, setHistory] = useState<Material | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [catManageOpen, setCatManageOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const flowRef = useRef<HTMLDivElement>(null);
  // 写操作按钮按系统管理配置的操作码显隐
  const can = useProcCan();

  // 编辑落库刷新后，已打开的详情抽屉要换成最新对象（否则停留在改前数据）
  useEffect(() => {
    setDetail((cur) => (cur ? materials.find((m) => m.id === cur.id) ?? null : cur));
  }, [materials]);

  const plMaterials = useMemo(() => materials.filter((m) => productLine === "all" || m.productLine === productLine), [materials, productLine]);
  // 物料名 → 分类的索引，用于把任务归到分类下
  const catOf = useMemo(() => new Map(materials.map((m) => [m.name, m.category] as const)), [materials]);

  const stats = useMemo(() => {
    const active = tasks.filter((t) => !["completed", "cancelled"].includes(t.status));
    const shortage = plMaterials.filter((m) => m.stockQty === 0 && active.some((t) => t.materialName === m.name)).length;
    const transitBatches = active.filter((t) => TRANSIT.includes(t.status)).length;
    const weekArrival = active.filter((t) => { const d = daysFromToday(t.expectedArrivalDate); return TRANSIT.includes(t.status) && d != null && d >= 0 && d <= 7; }).length;
    return { total: plMaterials.length, shortage, transitBatches, weekArrival };
  }, [plMaterials, tasks]);

  // 分类总览
  const categories = useMemo(() => {
    const names = Array.from(new Set(plMaterials.map((m) => m.category)));
    return names.map((cat) => {
      const mats = plMaterials.filter((m) => m.category === cat);
      const catTasks = tasks.filter((t) => catOf.get(t.materialName) === cat);
      const active = catTasks.filter((t) => !["completed", "cancelled"].includes(t.status));
      const transit = active.filter((t) => TRANSIT.includes(t.status));
      const week = transit.filter((t) => { const d = daysFromToday(t.expectedArrivalDate); return d != null && d >= 0 && d <= 7; });
      const shortage = mats.filter((m) => m.stockQty === 0 && active.some((t) => t.materialName === m.name)).length;
      const overdueTransit = transit.filter((t) => (daysFromToday(t.expectedArrivalDate) ?? 99) < 0).length;
      return { cat, matCount: mats.length, active: active.length, transit: transit.length, week: week.length, shortage, overdueTransit };
    });
  }, [plMaterials, tasks, catOf]);

  const filteredMaterials = useMemo(() => {
    const kw = search.trim().toLowerCase();
    return plMaterials.filter((m) => (!category || m.category === category) && (!kw || `${m.name} ${m.spec} ${m.erpCode}`.toLowerCase().includes(kw)));
  }, [plMaterials, category, search]);

  const selectCategory = (cat: string) => {
    setCategory((cur) => (cur === cat ? null : cat));
    setTimeout(() => flowRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
  };

  return (
    <div className="mx-auto w-full max-w-[1600px] p-4">
      <PageHeader
        Icon={Boxes}
        badge={t("采购管理")}
        title={t("采购工作台 · 物料库")}
        description={t("物料主数据与库存/在途资产视角：按产品线与分类总览，管理审核、缺料预警与历史价格。")}
        right={
          <div className="flex flex-wrap items-center gap-2">
            {can("proc-task:create") && <button type="button" onClick={() => setCreateOpen(true)} className="material-button-primary inline-flex items-center gap-1.5 px-3 py-2 text-sm"><Plus className="h-4 w-4" />{t("新增物料")}</button>}
            {can("material:import") && <button type="button" onClick={() => setImportOpen(true)} className="material-button-secondary inline-flex items-center gap-1.5 px-3 py-2 text-sm"><Upload className="h-4 w-4" />{t("批量导入")}</button>}
            {can("material:import") && <button type="button" onClick={() => setCatManageOpen(true)} className="material-button-secondary inline-flex items-center gap-1.5 px-3 py-2 text-sm"><FolderTree className="h-4 w-4" />{t("分类管理")}</button>}
            {can("proc:sync-erp") && <button type="button" onClick={() => stageToast()} title={t("V2 功能：将通过 ERP 接口同步库存")} className="inline-flex items-center gap-1.5 rounded-lg border border-dashed border-slate-300 px-3 py-2 text-sm text-slate-400 hover:bg-slate-50"><RefreshCw className="h-4 w-4" />{t("同步 ERP 库存")}</button>}
          </div>
        }
      />

      {/* 统计条（物料审核已移至采购任务驾驶舱，由管理员执行） */}
      <div className="mb-3 grid grid-cols-4 gap-3">
        <StatCell label={t("物料总数")} value={stats.total} Icon={Boxes} />
        <StatCell label={t("缺料预警")} value={stats.shortage} tone="red" badge={stats.shortage > 0} Icon={PackageCheck} />
        <StatCell label={t("在途批次")} value={stats.transitBatches} tone="indigo" Icon={Truck} />
        <StatCell label={t("本周到货批次")} value={stats.weekArrival} tone="emerald" Icon={PackageCheck} />
      </div>

      {/* 产品线 Tab */}
      <div className="material-card mb-3 flex flex-wrap items-center gap-1.5 px-4 py-3">
        <button type="button" onClick={() => { setProductLine("all"); setCategory(null); }} className={cn("rounded-full border px-3 py-1.5 text-xs font-medium", productLine === "all" ? "border-indigo-300 bg-indigo-50 text-indigo-600" : "border-slate-200 text-slate-500 hover:bg-slate-50")}>{t("全部")}</button>
        {PROC_PRODUCT_LINES.map((pl) => (
          <button key={pl} type="button" onClick={() => { setProductLine(pl); setCategory(null); }} className={cn("rounded-full border px-3 py-1.5 text-xs font-medium", productLine === pl ? "border-indigo-300 bg-indigo-50 text-indigo-600" : "border-slate-200 text-slate-500 hover:bg-slate-50")}><AutoTranslatedText text={t(pl.trim())} /></button>
        ))}
      </div>

      {/* 分类总览网格 */}
      <div className="mb-3 grid grid-cols-4 gap-3">
        {categories.map((c) => (
          <button key={c.cat} type="button" onClick={() => selectCategory(c.cat)} className={cn("material-card p-4 text-left transition hover:shadow-md", category === c.cat && "ring-2 ring-indigo-300")}>
            <div className="flex items-center justify-between">
              <AutoTranslatedText as="span" className="text-sm font-semibold text-slate-800" text={t(c.cat.trim())} />
              {(c.shortage > 0 || c.overdueTransit > 0) && <span className="rounded-full border border-red-200 bg-red-50 px-1.5 py-0.5 text-[10px] text-red-600">{c.shortage > 0 ? t("缺 {count}", { count: c.shortage }) : ""}{c.shortage > 0 && c.overdueTransit > 0 ? " · " : ""}{c.overdueTransit > 0 ? t("逾期 {count}", { count: c.overdueTransit }) : ""}</span>}
            </div>
            <div className="mt-2 flex items-baseline gap-1"><span className="text-2xl font-bold tabular-nums text-indigo-600">{c.active}</span><span className="text-[11px] text-slate-400">{t("进行中任务")}</span></div>
            <div className="mt-1.5 h-1 w-full overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-indigo-400" style={{ width: `${c.matCount ? Math.min(100, (c.active / Math.max(c.matCount, 1)) * 100) : 0}%` }} /></div>
            <div className="mt-2 flex justify-between text-[11px] text-slate-400"><span>{t("物料 {count}", { count: c.matCount })}</span><span>{t("在途 {count}", { count: c.transit })}</span><span>{t("本周 {count}", { count: c.week })}</span></div>
          </button>
        ))}
      </div>

      {/* 物料瀑布流 */}
      <div ref={flowRef} className="material-card p-4">
        <div className="mb-3 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <h2 className="text-base font-bold text-slate-900">{t("物料清单")}</h2>
            {category && <button type="button" onClick={() => setCategory(null)} className="rounded-full border border-indigo-200 bg-indigo-50 px-2 py-0.5 text-xs text-indigo-600"><AutoTranslatedText text={t(category.trim())} /> ✕</button>}
            <span className="text-xs text-slate-400">{t("{count} 条", { count: filteredMaterials.length })}</span>
          </div>
          <div className="flex items-center gap-1.5 rounded-lg border border-slate-200 px-2.5 py-1.5 text-sm">
            <Search className="h-4 w-4 text-slate-400" />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t("搜索名称 / 规格 / ERP 编码")} className="w-56 bg-transparent outline-none placeholder:text-slate-400" />
          </div>
        </div>
        <div className="grid grid-cols-3 items-start gap-3 xl:grid-cols-4">
          {error ? (
            <div className="col-span-full py-12 text-center text-sm text-red-500">{error}</div>
          ) : loading && materials.length === 0 ? (
            <div className="col-span-full py-12 text-center text-sm text-slate-400">{t("加载中")}…</div>
          ) : filteredMaterials.length === 0 ? (
            <div className="col-span-full py-12 text-center text-sm text-slate-400">{t("没有符合条件的物料")}</div>
          ) : null}
          {filteredMaterials.map((m) => (
            <MaterialCard
              key={m.id}
              material={m}
              onOpen={setDetail}
              onOpenHistory={setHistory}
              onOpenTasks={(mat) => navigate(`/proc-cockpit?material=${encodeURIComponent(mat.name)}`)}
            />
          ))}
        </div>
      </div>

      {detail && <MaterialDetailDrawer material={detail} onClose={() => setDetail(null)} onOpenTask={(taskId) => navigate(`/proc-cockpit?task=${encodeURIComponent(taskId)}`)} />}
      {history && <PriceHistoryModal materialName={history.name} open onClose={() => setHistory(null)} />}
      {importOpen && <ImportMaterialsModal onClose={() => setImportOpen(false)} />}
      {createOpen && <MaterialFormModal onClose={() => setCreateOpen(false)} />}
      {catManageOpen && <CategoryManageModal onClose={() => setCatManageOpen(false)} />}
    </div>
  );
}
