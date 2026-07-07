// 采购分类详情（二级页，无侧边栏入口）：从驾驶舱「分类看板」卡片进入。
// 结构：分类统计条 + 物料维度二级目录（每个物料一个目录卡：库存/在途/缺料预警 + 该物料的采购任务）。
// 路由 /proc-category?cat=分类[&line=产品线]。
import { useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { ArrowLeft, Activity, AlertTriangle, Boxes, Truck } from "lucide-react";
import { cn } from "../components/ui/utils";
import { MATERIALS, PROCUREMENT_TASKS, daysFromDemoToday, taskRequester, type Material, type ProcStatus, type ProcurementTask } from "../../mock/procurement";
import { MainDateBadge, PersonAvatar, StatCell, StatusPill, fmtMoney } from "./components/common";
import { TaskDetailDrawer } from "./components/TaskDetailDrawer";

const TRANSIT: ProcStatus[] = ["in_transit", "partial_arrival"];
const DONE: ProcStatus[] = ["completed", "cancelled"];

type MaterialGroup = {
  material: Material;
  tasks: ProcurementTask[];
  activeCount: number;
  transitCount: number;
  transitQty: number;
  shortage: boolean;
};

/** 物料二级目录卡：卡头 = 物料信息 + 库存/在途/缺料，卡体 = 该物料的采购任务行。 */
function MaterialGroupCard({ group, onOpenTask }: { group: MaterialGroup; onOpenTask: (t: ProcurementTask) => void }) {
  const { material: m, tasks, activeCount, transitCount, transitQty, shortage } = group;
  return (
    <section className="material-card overflow-hidden">
      {/* 卡头：物料标识 + 库存/在途/缺料预警 */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-slate-100 bg-slate-50/60 px-4 py-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-bold text-slate-900">{m.name}</span>
            <span className="text-xs text-slate-400">{m.spec}</span>
            <span className="rounded-full border border-slate-200 bg-white px-2 py-0.5 text-[11px] text-slate-500">{m.productLine}</span>
            <span className="font-mono text-[11px] text-slate-400">{m.erpCode}</span>
          </div>
          <div className="mt-1 text-[11px] text-slate-400">
            最新报价 {fmtMoney(m.latestPrice)}{m.latestSupplier ? ` · ${m.latestSupplier}` : ""} · 进行中任务 {activeCount}
          </div>
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <span className={cn("inline-flex items-center gap-1 rounded-lg border px-2.5 py-1 text-xs", m.stockQty === 0 ? "border-red-200 bg-red-50 text-red-600" : "border-slate-200 bg-white text-slate-600")}>
            库存 <b className="tabular-nums">{m.stockQty === 0 ? "无" : `${m.stockQty.toLocaleString()} ${m.unit}`}</b>
          </span>
          <span className={cn("inline-flex items-center gap-1 rounded-lg border px-2.5 py-1 text-xs", transitCount > 0 ? "border-violet-200 bg-violet-50 text-violet-700" : "border-slate-200 bg-white text-slate-400")}>
            <Truck className="h-3.5 w-3.5" />在途 <b className="tabular-nums">{transitCount > 0 ? `${transitCount} 批 · ${transitQty.toLocaleString()} ${m.unit}` : "0"}</b>
          </span>
          {shortage && (
            <span className="inline-flex items-center gap-1 rounded-lg border border-red-200 bg-red-50 px-2.5 py-1 text-xs font-semibold text-red-600">
              <AlertTriangle className="h-3.5 w-3.5" />缺料预警
            </span>
          )}
        </div>
      </div>

      {/* 卡体：该物料的采购任务 */}
      {tasks.length === 0 ? (
        <div className="px-4 py-5 text-center text-xs text-slate-400">该物料暂无采购任务</div>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-50 text-left text-xs text-slate-400">
              <th className="px-4 py-2 font-medium">编号</th>
              <th className="px-3 py-2 font-medium">数量</th>
              <th className="px-3 py-2 font-medium">状态</th>
              <th className="px-3 py-2 font-medium">主日期</th>
              <th className="px-3 py-2 font-medium">提出人</th>
              <th className="px-3 py-2 font-medium">采购</th>
              <th className="px-3 py-2 font-medium">到货</th>
            </tr>
          </thead>
          <tbody>
            {tasks.map((t) => (
              <tr key={t.id} onClick={() => onOpenTask(t)} className="cursor-pointer border-b border-slate-50 transition last:border-0 hover:bg-indigo-50/40">
                <td className="whitespace-nowrap px-4 py-2.5 font-mono text-xs text-slate-400">{t.code}</td>
                <td className="whitespace-nowrap px-3 py-2.5 tabular-nums text-slate-600">{t.quantity.toLocaleString()} {t.unit}</td>
                <td className="whitespace-nowrap px-3 py-2.5"><StatusPill status={t.status} /></td>
                <td className="whitespace-nowrap px-3 py-2.5"><MainDateBadge task={t} /></td>
                <td className="whitespace-nowrap px-3 py-2.5">
                  <span className="inline-flex items-center gap-1.5 text-xs text-slate-600"><PersonAvatar name={taskRequester(t).name} size="xs" />{taskRequester(t).name}</span>
                </td>
                <td className="whitespace-nowrap px-3 py-2.5">
                  <span className="inline-flex items-center gap-1.5 text-xs text-slate-600"><PersonAvatar name={t.buyer} size="xs" />{t.buyer}</span>
                </td>
                <td className="whitespace-nowrap px-3 py-2.5 text-xs tabular-nums text-slate-500">{t.arrivedQty.toLocaleString()} / {t.quantity.toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

export function ProcCategoryDetailPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const cat = params.get("cat") ?? "";
  const line = params.get("line") ?? "all";
  const [open, setOpen] = useState<ProcurementTask | null>(null);

  const materials = useMemo(
    () => MATERIALS.filter((m) => m.category === cat && (line === "all" || m.productLine === line)),
    [cat, line],
  );
  const tasks = useMemo(
    () => PROCUREMENT_TASKS.filter((t) => materials.some((m) => m.name === t.materialName)),
    [materials],
  );

  // 物料维度二级目录：每个物料聚合 任务/库存/在途/缺料
  const groups = useMemo<MaterialGroup[]>(() => materials.map((m) => {
    const mTasks = tasks.filter((t) => t.materialName === m.name);
    const active = mTasks.filter((t) => !DONE.includes(t.status));
    const transitTasks = active.filter((t) => TRANSIT.includes(t.status));
    const transitQty = transitTasks.reduce((sum, t) => sum + Math.max(0, t.quantity - t.arrivedQty), 0);
    return {
      material: m,
      tasks: mTasks,
      activeCount: active.length,
      transitCount: transitTasks.length,
      transitQty,
      shortage: m.stockQty === 0 && active.length > 0,
    };
  }), [materials, tasks]);

  const stats = useMemo(() => ({
    active: groups.reduce((sum, g) => sum + g.activeCount, 0),
    transit: groups.reduce((sum, g) => sum + g.transitCount, 0),
    week: tasks.filter((t) => { const d = daysFromDemoToday(t.expectedArrivalDate); return TRANSIT.includes(t.status) && d != null && d >= 0 && d <= 7; }).length,
    shortage: groups.filter((g) => g.shortage).length,
  }), [groups, tasks]);

  return (
    <div className="mx-auto w-full max-w-[1600px] p-4">
      {/* 页头：返回 + 分类名 + 产品线范围 */}
      <div className="material-card mb-3 flex flex-wrap items-center gap-3 px-4 py-3">
        <button type="button" onClick={() => navigate("/proc-cockpit?view=board")} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50">
          <ArrowLeft className="h-4 w-4" />返回分类看板
        </button>
        <h1 className="text-lg font-bold text-slate-900">{cat || "未指定分类"}</h1>
        <span className="rounded-full border border-indigo-200 bg-indigo-50 px-2.5 py-0.5 text-xs text-indigo-600">{line === "all" ? "全部产品线" : line}</span>
        <span className="ml-auto text-xs text-slate-400">{tasks.length} 个任务 · {materials.length} 个物料</span>
      </div>

      {!cat || materials.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-200 py-16 text-center text-sm text-slate-400">
          该分类下暂无物料数据，请从采购任务驾驶舱的分类看板进入
        </div>
      ) : (
        <>
          {/* 分类级统计条 */}
          <div className="mb-3 grid grid-cols-4 gap-3">
            <StatCell label="进行中任务" value={stats.active} Icon={Activity} />
            <StatCell label="物料数" value={materials.length} Icon={Boxes} />
            <StatCell label="在途批次" value={stats.transit} tone="violet" Icon={Truck} />
            <StatCell label="缺料预警" value={stats.shortage} tone={stats.shortage > 0 ? "red" : "slate"} badge={stats.shortage > 0} Icon={AlertTriangle} />
          </div>

          {/* 二级目录：物料维度分组（库存 / 在途 / 缺料 + 任务明细） */}
          <div className="mb-2 flex items-center gap-2 text-sm font-bold text-slate-900">
            <Boxes className="h-4 w-4 text-indigo-500" />物料目录（{groups.length}）
          </div>
          <div className="space-y-3">
            {groups.map((group) => (
              <MaterialGroupCard key={group.material.id} group={group} onOpenTask={setOpen} />
            ))}
          </div>
        </>
      )}

      {open && <TaskDetailDrawer task={open} onClose={() => setOpen(null)} />}
    </div>
  );
}