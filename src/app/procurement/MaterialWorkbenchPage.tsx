// 采购工作台（资产视角 · 物料库）：统计条 + 产品线Tab + 分类总览网格 + 物料瀑布流 + 物料详情抽屉。
import { useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { Boxes, ClipboardCheck, FolderTree, PackageCheck, RefreshCw, Search, Truck, Upload } from "lucide-react";
import { cn } from "../components/ui/utils";
import { MATERIALS, PROCUREMENT_TASKS, PROC_PRODUCT_LINES, daysFromDemoToday, materialAggregates, type Material, type ProcStatus } from "../../mock/procurement";
import { PageHeader, StatCell, stageToast } from "./components/common";
import { MaterialCard } from "./components/MaterialCard";
import { MaterialDetailDrawer } from "./components/MaterialDetailDrawer";
import { PriceHistoryModal } from "./components/PriceHistoryModal";
import { CategoryManageModal, ImportMaterialsModal, ReviewQueueDrawer } from "./components/modals";

const TRANSIT: ProcStatus[] = ["in_transit", "partial_arrival"];
const CAT_OF = new Map(MATERIALS.map((m) => [m.name, m.category] as const));

export function MaterialWorkbenchPage() {
  const navigate = useNavigate();
  const [productLine, setProductLine] = useState<(typeof PROC_PRODUCT_LINES)[number] | "all">("all");
  const [category, setCategory] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [detail, setDetail] = useState<Material | null>(null);
  const [history, setHistory] = useState<Material | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [catManageOpen, setCatManageOpen] = useState(false);
  const flowRef = useRef<HTMLDivElement>(null);

  const plMaterials = useMemo(() => MATERIALS.filter((m) => productLine === "all" || m.productLine === productLine), [productLine]);

  const stats = useMemo(() => {
    const active = PROCUREMENT_TASKS.filter((t) => !["completed", "cancelled"].includes(t.status));
    const shortage = plMaterials.filter((m) => m.stockQty === 0 && active.some((t) => t.materialName === m.name)).length;
    const transitBatches = active.filter((t) => TRANSIT.includes(t.status)).length;
    const weekArrival = active.filter((t) => { const d = daysFromDemoToday(t.expectedArrivalDate); return TRANSIT.includes(t.status) && d != null && d >= 0 && d <= 7; }).length;
    return { total: plMaterials.length, pending: plMaterials.filter((m) => m.reviewStatus === "pending").length, shortage, transitBatches, weekArrival };
  }, [plMaterials]);

  // 分类总览
  const categories = useMemo(() => {
    const names = Array.from(new Set(plMaterials.map((m) => m.category)));
    return names.map((cat) => {
      const mats = plMaterials.filter((m) => m.category === cat);
      const catTasks = PROCUREMENT_TASKS.filter((t) => CAT_OF.get(t.materialName) === cat);
      const active = catTasks.filter((t) => !["completed", "cancelled"].includes(t.status));
      const transit = active.filter((t) => TRANSIT.includes(t.status));
      const week = transit.filter((t) => { const d = daysFromDemoToday(t.expectedArrivalDate); return d != null && d >= 0 && d <= 7; });
      const shortage = mats.filter((m) => m.stockQty === 0 && active.some((t) => t.materialName === m.name)).length;
      const overdueTransit = transit.filter((t) => (daysFromDemoToday(t.expectedArrivalDate) ?? 99) < 0).length;
      return { cat, matCount: mats.length, active: active.length, transit: transit.length, week: week.length, shortage, overdueTransit };
    });
  }, [plMaterials]);

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
        badge="采购管理"
        title="采购工作台 · 物料库"
        description="物料主数据与库存/在途资产视角：按产品线与分类总览，管理审核、缺料预警与历史价格。"
        right={
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={() => setImportOpen(true)} className="material-button-secondary inline-flex items-center gap-1.5 px-3 py-2 text-sm"><Upload className="h-4 w-4" />批量导入</button>
            <button type="button" onClick={() => setReviewOpen(true)} className="material-button-secondary inline-flex items-center gap-1.5 px-3 py-2 text-sm"><ClipboardCheck className="h-4 w-4" />审核队列{stats.pending > 0 && <span className="rounded-full bg-amber-100 px-1.5 text-[10px] text-amber-700">{stats.pending}</span>}</button>
            <button type="button" onClick={() => setCatManageOpen(true)} className="material-button-secondary inline-flex items-center gap-1.5 px-3 py-2 text-sm"><FolderTree className="h-4 w-4" />分类管理</button>
            <button type="button" onClick={() => stageToast()} title="V2 功能：将通过 ERP 接口同步库存" className="inline-flex items-center gap-1.5 rounded-lg border border-dashed border-slate-300 px-3 py-2 text-sm text-slate-400 hover:bg-slate-50"><RefreshCw className="h-4 w-4" />同步 ERP 库存</button>
          </div>
        }
      />

      {/* 统计条 */}
      <div className="mb-3 grid grid-cols-5 gap-3">
        <StatCell label="物料总数" value={stats.total} Icon={Boxes} />
        <StatCell label="待审核" value={stats.pending} tone={stats.pending > 0 ? "amber" : "slate"} badge={stats.pending > 0} Icon={ClipboardCheck} onClick={() => setReviewOpen(true)} />
        <StatCell label="缺料预警" value={stats.shortage} tone="red" badge={stats.shortage > 0} Icon={PackageCheck} />
        <StatCell label="在途批次" value={stats.transitBatches} tone="indigo" Icon={Truck} />
        <StatCell label="本周到货批次" value={stats.weekArrival} tone="emerald" Icon={PackageCheck} />
      </div>

      {/* 产品线 Tab */}
      <div className="material-card mb-3 flex flex-wrap items-center gap-1.5 px-4 py-3">
        <button type="button" onClick={() => { setProductLine("all"); setCategory(null); }} className={cn("rounded-full border px-3 py-1.5 text-xs font-medium", productLine === "all" ? "border-indigo-300 bg-indigo-50 text-indigo-600" : "border-slate-200 text-slate-500 hover:bg-slate-50")}>全部</button>
        {PROC_PRODUCT_LINES.map((pl) => (
          <button key={pl} type="button" onClick={() => { setProductLine(pl); setCategory(null); }} className={cn("rounded-full border px-3 py-1.5 text-xs font-medium", productLine === pl ? "border-indigo-300 bg-indigo-50 text-indigo-600" : "border-slate-200 text-slate-500 hover:bg-slate-50")}>{pl}</button>
        ))}
      </div>

      {/* 分类总览网格 */}
      <div className="mb-3 grid grid-cols-4 gap-3">
        {categories.map((c) => (
          <button key={c.cat} type="button" onClick={() => selectCategory(c.cat)} className={cn("material-card p-4 text-left transition hover:shadow-md", category === c.cat && "ring-2 ring-indigo-300")}>
            <div className="flex items-center justify-between">
              <span className="text-sm font-semibold text-slate-800">{c.cat}</span>
              {(c.shortage > 0 || c.overdueTransit > 0) && <span className="rounded-full border border-red-200 bg-red-50 px-1.5 py-0.5 text-[10px] text-red-600">{c.shortage > 0 ? `缺${c.shortage}` : ""}{c.shortage > 0 && c.overdueTransit > 0 ? " · " : ""}{c.overdueTransit > 0 ? `逾期${c.overdueTransit}` : ""}</span>}
            </div>
            <div className="mt-2 flex items-baseline gap-1"><span className="text-2xl font-bold tabular-nums text-indigo-600">{c.active}</span><span className="text-[11px] text-slate-400">进行中任务</span></div>
            <div className="mt-1.5 h-1 w-full overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-indigo-400" style={{ width: `${c.matCount ? Math.min(100, (c.active / Math.max(c.matCount, 1)) * 100) : 0}%` }} /></div>
            <div className="mt-2 flex justify-between text-[11px] text-slate-400"><span>物料 {c.matCount}</span><span>在途 {c.transit}</span><span>本周 {c.week}</span></div>
          </button>
        ))}
      </div>

      {/* 物料瀑布流 */}
      <div ref={flowRef} className="material-card p-4">
        <div className="mb-3 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <h2 className="text-base font-bold text-slate-900">物料清单</h2>
            {category && <button type="button" onClick={() => setCategory(null)} className="rounded-full border border-indigo-200 bg-indigo-50 px-2 py-0.5 text-xs text-indigo-600">{category} ✕</button>}
            <span className="text-xs text-slate-400">{filteredMaterials.length} 条</span>
          </div>
          <div className="flex items-center gap-1.5 rounded-lg border border-slate-200 px-2.5 py-1.5 text-sm">
            <Search className="h-4 w-4 text-slate-400" />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="搜索名称 / 规格 / ERP 编码" className="w-56 bg-transparent outline-none placeholder:text-slate-400" />
          </div>
        </div>
        <div className="grid grid-cols-3 items-start gap-3 xl:grid-cols-4">
          {filteredMaterials.length === 0 && <div className="col-span-full py-12 text-center text-sm text-slate-400">没有符合条件的物料</div>}
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
      {reviewOpen && <ReviewQueueDrawer onClose={() => setReviewOpen(false)} />}
      {catManageOpen && <CategoryManageModal onClose={() => setCatManageOpen(false)} />}
    </div>
  );
}
