// 采购任务驾驶舱（流程视角）：业务线 Tab + 操作行 + 统计条 + 人员泳道 + 三列瀑布流。
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { AnimatePresence, motion, useMotionValue } from "motion/react";
import { Activity, AlertTriangle, ClipboardList, Download, Grid3x3, LayoutGrid, PackageCheck, Plus, Search, Sparkles, Truck, Users } from "lucide-react";
import { cn } from "../components/ui/utils";
import { MATERIALS, PROCUREMENT_TASKS, PROC_PRODUCT_LINES, daysFromDemoToday, taskMainDate, taskRequester, type ProcStatus, type ProcurementTask } from "../../mock/procurement";
import { PersonAvatar, StatCell, stageToast } from "./components/common";
import { ProcurementTaskCard } from "./components/ProcurementTaskCard";
import { TaskDetailDrawer } from "./components/TaskDetailDrawer";
import { AiCreateModal, NewRequirementModal } from "./components/modals";

const ACTIVE_STATUSES: ProcStatus[] = ["pending_confirm", "pending_inquiry", "inquiring", "pending_sample", "testing", "priced", "pending_purchase", "in_transit", "partial_arrival"];
const TRANSIT_STATUSES: ProcStatus[] = ["in_transit", "partial_arrival"];
/** 瀑布流每批渲染数量（约一屏三列），滚动到底自动追加 */
const WATERFALL_PAGE_SIZE = 9;
/** 视图切换悬浮球拖拽位置的本地记忆键 */
const FLOAT_BTN_POS_KEY = "proc-cockpit-float-btn-pos";

const CAT_TRANSIT: ProcStatus[] = ["in_transit", "partial_arrival"];

/** 分类看板视图：产品线 Tab + 分类总览网格（与采购工作台同口径），卡片点击进入分类详情二级页。 */
function CategoryBoardView({ onOpenCategory }: { onOpenCategory: (cat: string, line: string) => void }) {
  const [productLine, setProductLine] = useState<string>("all");
  const plMaterials = useMemo(() => MATERIALS.filter((m) => productLine === "all" || m.productLine === productLine), [productLine]);
  const categories = useMemo(() => {
    const names = Array.from(new Set(plMaterials.map((m) => m.category)));
    return names.map((cat) => {
      const mats = plMaterials.filter((m) => m.category === cat);
      // 任务按「当前产品线内的物料」归集，与二级详情页 /proc-category 的口径一致（避免卡片数字与详情对不上）
      const catTasks = PROCUREMENT_TASKS.filter((t) => mats.some((m) => m.name === t.materialName));
      const active = catTasks.filter((t) => !["completed", "cancelled"].includes(t.status));
      const transit = active.filter((t) => CAT_TRANSIT.includes(t.status));
      const week = transit.filter((t) => { const d = daysFromDemoToday(t.expectedArrivalDate); return d != null && d >= 0 && d <= 7; });
      const shortage = mats.filter((m) => m.stockQty === 0 && active.some((t) => t.materialName === m.name)).length;
      const overdueTransit = transit.filter((t) => (daysFromDemoToday(t.expectedArrivalDate) ?? 99) < 0).length;
      return { cat, matCount: mats.length, active: active.length, transit: transit.length, week: week.length, shortage, overdueTransit };
    });
  }, [plMaterials]);

  return (
    <div className="space-y-3">
      <div className="material-card flex flex-wrap items-center gap-1.5 px-4 py-3">
        <button type="button" onClick={() => setProductLine("all")} className={cn("rounded-full border px-3 py-1.5 text-xs font-medium", productLine === "all" ? "border-indigo-300 bg-indigo-50 text-indigo-600" : "border-slate-200 text-slate-500 hover:bg-slate-50")}>全部</button>
        {PROC_PRODUCT_LINES.map((pl) => (
          <button key={pl} type="button" onClick={() => setProductLine(pl)} className={cn("rounded-full border px-3 py-1.5 text-xs font-medium", productLine === pl ? "border-indigo-300 bg-indigo-50 text-indigo-600" : "border-slate-200 text-slate-500 hover:bg-slate-50")}>{pl}</button>
        ))}
      </div>
      <div className="grid grid-cols-4 gap-3">
        {categories.map((c) => (
          <button key={c.cat} type="button" onClick={() => onOpenCategory(c.cat, productLine)} className="material-card p-4 text-left transition hover:shadow-md">
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
    </div>
  );
}

type StatKey = "inprogress" | "pending" | "inquiring" | "transit" | "overdue" | "week";

export function ProcurementCockpitPage() {
  const tasks = PROCUREMENT_TASKS;
  const [params, setParams] = useSearchParams();
  const [open, setOpen] = useState<ProcurementTask | null>(null);
  const [stat, setStat] = useState<StatKey | null>(null);
  const [person, setPerson] = useState<string | null>(null);
  const [aiOpen, setAiOpen] = useState(false);
  const [newOpen, setNewOpen] = useState(false);

  // 视图形态：瀑布流卡片 / 分类看板，悬浮按钮切换，同步到 ?view=
  const navigate = useNavigate();
  const view: "cards" | "board" = params.get("view") === "board" ? "board" : "cards";
  const nextView: typeof view = view === "cards" ? "board" : "cards";
  const toggleView = () => setParams((p) => {
    const n = new URLSearchParams(p);
    if (nextView === "cards") n.delete("view"); else n.set("view", nextView);
    return n;
  }, { replace: true });

  // 悬浮球：默认锚定右侧垂直居中（right-6 + top-1/2），可拖拽，位置记忆到 localStorage
  const dragBounds = useMemo(() => {
    if (typeof window === "undefined") return { left: 0, right: 0, top: 0, bottom: 0 };
    return {
      left: -(window.innerWidth - 104), // 向左最多拖到距左缘约 32px
      right: 16,
      top: -(window.innerHeight / 2 - 72),
      bottom: window.innerHeight / 2 - 72,
    };
  }, []);
  const initialBtnPos = useMemo(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(FLOAT_BTN_POS_KEY) ?? "null") as { x: number; y: number } | null;
      if (saved && Number.isFinite(saved.x) && Number.isFinite(saved.y)) {
        // 记忆值按当前视口钳制，避免分辨率变化后按钮丢到屏幕外
        return {
          x: Math.min(Math.max(saved.x, dragBounds.left), dragBounds.right),
          y: Math.min(Math.max(saved.y, dragBounds.top), dragBounds.bottom),
        };
      }
    } catch { /* 忽略损坏的记忆值 */ }
    return { x: 0, y: 0 };
  }, [dragBounds]);
  const btnX = useMotionValue(initialBtnPos.x);
  const btnY = useMotionValue(initialBtnPos.y);
  // 拖拽标志：按钮跟手移动时指针始终在按钮内，松手会同时命中 tap 判定，需手动挡掉误触发的视图切换
  const draggingRef = useRef(false);
  const handleDragStart = () => { draggingRef.current = true; };
  const handleDragEnd = () => {
    try { localStorage.setItem(FLOAT_BTN_POS_KEY, JSON.stringify({ x: btnX.get(), y: btnY.get() })); } catch { /* 存储不可用时忽略 */ }
    requestAnimationFrame(() => { draggingRef.current = false; });
  };
  const handleTap = () => { if (!draggingRef.current) toggleView(); };

  // 业务线 Tab 作为整页作用域（统计条/人员泳道/到货付款速览均随之变化），同步到 ?line= 便于刷新与分享
  const lineParam = params.get("line");
  const line: "all" | "rd" | "production" = lineParam === "rd" || lineParam === "production" ? lineParam : "all";
  const setLine = (k: "all" | "rd" | "production") => setParams((p) => { const n = new URLSearchParams(p); if (k === "all") n.delete("line"); else n.set("line", k); return n; }, { replace: true });

  const materialParam = params.get("material");
  const taskParam = params.get("task");
  // 从物料页跳转：?task= 自动打开详情；?material= 过滤瀑布流。
  useEffect(() => {
    if (taskParam) {
      const t = tasks.find((x) => x.id === taskParam);
      if (t) setOpen(t);
    }
  }, [taskParam, tasks]);

  const isOverdue = (t: ProcurementTask) => TRANSIT_STATUSES.includes(t.status) && (daysFromDemoToday(t.expectedArrivalDate) ?? 99) < 0;
  const isThisWeek = (t: ProcurementTask) => { const d = daysFromDemoToday(t.expectedArrivalDate); return TRANSIT_STATUSES.includes(t.status) && d != null && d >= 0 && d <= 7; };

  // Tab 数量徽标按全量任务计，作用域内数据一律用 lineTasks
  const lineTasks = useMemo(() => (line === "all" ? tasks : tasks.filter((t) => t.businessLine === line)), [tasks, line]);
  const lineCounts = useMemo(() => ({
    all: tasks.length,
    production: tasks.filter((t) => t.businessLine === "production").length,
    rd: tasks.filter((t) => t.businessLine === "rd").length,
  }), [tasks]);

  const counts = useMemo(() => ({
    inprogress: lineTasks.filter((t) => ACTIVE_STATUSES.includes(t.status)).length,
    pending: lineTasks.filter((t) => t.status === "pending_confirm").length,
    inquiring: lineTasks.filter((t) => t.status === "inquiring").length,
    transit: lineTasks.filter((t) => TRANSIT_STATUSES.includes(t.status)).length,
    overdue: lineTasks.filter(isOverdue).length,
    week: lineTasks.filter(isThisWeek).length,
  }), [lineTasks]);

  // 人员泳道维度：采购负责人 + 研发对接人 + 需求提出人
  const people = useMemo(() => {
    const m = new Map<string, number>();
    for (const t of lineTasks) {
      const names = new Set([t.buyer, t.rdContact, taskRequester(t).name].filter(Boolean) as string[]);
      for (const name of names) m.set(name, (m.get(name) ?? 0) + 1);
    }
    return Array.from(m.entries());
  }, [lineTasks]);

  const filtered = useMemo(() => {
    let list = lineTasks.filter((t) => {
      if (!stat) return true;
      if (stat === "inprogress") return ACTIVE_STATUSES.includes(t.status);
      if (stat === "pending") return t.status === "pending_confirm";
      if (stat === "inquiring") return t.status === "inquiring";
      if (stat === "transit") return TRANSIT_STATUSES.includes(t.status);
      if (stat === "overdue") return isOverdue(t);
      if (stat === "week") return isThisWeek(t);
      return true;
    });
    if (person) list = list.filter((t) => t.buyer === person || t.rdContact === person || taskRequester(t).name === person);
    if (materialParam) list = list.filter((t) => t.materialName === materialParam);
    // 待处理置顶；其余按主日期升序
    return [...list].sort((a, b) => {
      if ((a.status === "pending_confirm") !== (b.status === "pending_confirm")) return a.status === "pending_confirm" ? -1 : 1;
      const da = taskMainDate(a).date ?? "9999";
      const db = taskMainDate(b).date ?? "9999";
      return da.localeCompare(db);
    });
  }, [lineTasks, stat, person, materialParam]);

  const toggleStat = (k: StatKey) => setStat((cur) => (cur === k ? null : k));

  // 瀑布流分批渲染：首屏一批，滚动到底部哨兵自动追加；筛选条件变化重置
  const [visibleCount, setVisibleCount] = useState(WATERFALL_PAGE_SIZE);
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => { setVisibleCount(WATERFALL_PAGE_SIZE); }, [line, person, stat, materialParam]);
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el || visibleCount >= filtered.length) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setVisibleCount((count) => Math.min(count + WATERFALL_PAGE_SIZE, filtered.length));
        }
      },
      { rootMargin: "200px" },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [visibleCount, filtered.length]);
  const visibleTasks = filtered.slice(0, visibleCount);

  return (
    <div className="mx-auto w-full max-w-[1600px] p-4">
      {/* 页头（业务线 Tab + 操作按钮）/ 统计条 / 人员泳道：仅任务视图展示，分类看板模式下隐藏 */}
      {view !== "board" && (
      <>
      <div className="material-card mb-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-3 py-2">
        <div className="inline-flex items-center gap-1 rounded-lg bg-slate-100 p-1">
          {([["all", "全部"], ["production", "生产"], ["rd", "研发"]] as const).map(([k, lbl]) => (
            <button key={k} type="button" onClick={() => setLine(k)} className={cn("flex items-center gap-1.5 rounded-md px-4 py-1.5 text-sm transition", line === k ? "bg-white font-semibold text-indigo-700 shadow-sm" : "font-medium text-slate-500 hover:text-slate-700")}>
              {lbl}
              <span className={cn("rounded-full px-1.5 text-[11px] font-medium tabular-nums", line === k ? "bg-indigo-50 text-indigo-600" : "bg-slate-200/70 text-slate-500")}>{lineCounts[k]}</span>
            </button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={stageToast} className="material-button-secondary inline-flex items-center gap-1.5 px-3 py-1.5 text-sm"><Download className="h-4 w-4" />导出</button>
          <button type="button" onClick={() => setAiOpen(true)} className="material-button-primary inline-flex items-center gap-1.5 px-3 py-1.5 text-sm"><Sparkles className="h-4 w-4" />AI 建单</button>
          <button type="button" onClick={stageToast} className="material-button-secondary inline-flex items-center gap-1.5 px-3 py-1.5 text-sm"><Users className="h-4 w-4" />批量转派</button>
          <button type="button" onClick={() => setNewOpen(true)} className="material-button-secondary inline-flex items-center gap-1.5 px-3 py-1.5 text-sm"><Plus className="h-4 w-4" />新建需求</button>
        </div>
      </div>

      {/* 统计条 */}
      <div className="mb-3 grid grid-cols-6 gap-3">
        <StatCell label="进行中" value={counts.inprogress} Icon={Activity} active={stat === "inprogress"} onClick={() => toggleStat("inprogress")} />
        <StatCell label="待处理" value={counts.pending} tone={counts.pending > 0 ? "red" : "slate"} badge={counts.pending > 0} Icon={ClipboardList} active={stat === "pending"} onClick={() => toggleStat("pending")} />
        <StatCell label="询价中" value={counts.inquiring} tone="indigo" Icon={Search} active={stat === "inquiring"} onClick={() => toggleStat("inquiring")} />
        <StatCell label="在途" value={counts.transit} tone="violet" Icon={Truck} active={stat === "transit"} onClick={() => toggleStat("transit")} />
        <StatCell label="逾期" value={counts.overdue} tone="red" Icon={AlertTriangle} active={stat === "overdue"} onClick={() => toggleStat("overdue")} />
        <StatCell label="本周到货" value={counts.week} tone="emerald" Icon={PackageCheck} active={stat === "week"} onClick={() => toggleStat("week")} />
      </div>

      {/* 人员泳道 */}
      <div className="material-card mb-3 flex flex-wrap items-center gap-2 px-4 py-3">
        <span className="mr-1 text-xs text-slate-400">人员</span>
        <button type="button" onClick={() => setPerson(null)} className={cn("rounded-full border px-2.5 py-1 text-xs font-medium", !person ? "border-indigo-300 bg-indigo-50 text-indigo-600" : "border-slate-200 text-slate-500 hover:bg-slate-50")}>全部</button>
        {people.map(([name, n]) => (
          <button key={name} type="button" onClick={() => setPerson((cur) => (cur === name ? null : name))} className={cn("flex items-center gap-1.5 rounded-full border py-0.5 pl-0.5 pr-2 text-xs font-medium", person === name ? "border-indigo-300 bg-indigo-50 text-indigo-600" : "border-slate-200 text-slate-600 hover:bg-slate-50")}>
            <PersonAvatar name={name} size="xs" />
            {name}
            <span className="rounded-full bg-slate-100 px-1.5 text-[10px] text-slate-500">{n}</span>
          </button>
        ))}
        {materialParam && (
          <button type="button" onClick={() => setParams((p) => { const n = new URLSearchParams(p); n.delete("material"); return n; }, { replace: true })} className="rounded-full border border-indigo-200 bg-indigo-50 px-2 py-0.5 text-xs text-indigo-600">物料：{materialParam} ✕</button>
        )}
        <span className="ml-auto text-xs text-slate-400">{filtered.length} 个任务</span>
      </div>
      </>
      )}

      {/* 任务展示区：瀑布流 / 分类看板两种视图，悬浮按钮切换；过渡只动 opacity/transform 不掉帧 */}
      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={view}
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -12 }}
          transition={{ duration: 0.22, ease: "easeOut" }}
        >
          {view === "board" ? (
            <CategoryBoardView onOpenCategory={(cat, pl) => navigate(`/proc-category?cat=${encodeURIComponent(cat)}${pl !== "all" ? `&line=${encodeURIComponent(pl)}` : ""}`)} />
          ) : filtered.length === 0 ? (
            <div className="rounded-xl border border-dashed border-slate-200 py-12 text-center text-sm text-slate-400">没有符合条件的任务</div>
          ) : (
              <>
                {/* 瀑布流：CSS 多列实现（待处理置顶项落在第一列顶部）；分批渲染 + 滚动加载更多 */}
                <div className="columns-3 gap-3">
                  {visibleTasks.map((t) => (
                    <div key={t.id} className="mb-3 break-inside-avoid">
                      <ProcurementTaskCard task={t} onOpen={setOpen} />
                    </div>
                  ))}
                </div>
                {visibleCount < filtered.length ? (
                  <div ref={sentinelRef} className="flex items-center justify-center gap-2 py-4 text-xs text-slate-400">
                    <span className="h-3 w-3 animate-spin rounded-full border-2 border-slate-300 border-t-indigo-500" />
                    下拉加载更多（{visibleCount} / {filtered.length}）
                  </div>
                ) : filtered.length > WATERFALL_PAGE_SIZE ? (
                  <div className="py-4 text-center text-xs text-slate-300">已加载全部 {filtered.length} 个任务</div>
                ) : null}
              </>
            )}
          </motion.div>
        </AnimatePresence>

      {/* 视图切换悬浮球：默认右侧垂直居中，可拖拽（拖完记忆位置）；onTap 与拖拽手势互斥，不会误触发切换 */}
      <motion.button
        type="button"
        drag
        dragMomentum={false}
        dragElastic={0.05}
        dragConstraints={dragBounds}
        style={{ x: btnX, y: btnY }}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
        onTap={handleTap}
        title={nextView === "board" ? "切换为分类看板（可拖拽移动）" : "切换为瀑布流视图（可拖拽移动）"}
        className="fixed right-6 top-1/2 z-40 -mt-6 flex h-12 w-12 cursor-grab items-center justify-center rounded-full bg-indigo-600 text-white shadow-lg shadow-indigo-300/60 transition-colors hover:bg-indigo-700 active:cursor-grabbing"
      >
        <motion.span key={view} initial={{ rotate: -90, opacity: 0 }} animate={{ rotate: 0, opacity: 1 }} transition={{ duration: 0.25 }} className="flex">
          {nextView === "board" ? <Grid3x3 className="h-5 w-5" /> : <LayoutGrid className="h-5 w-5" />}
        </motion.span>
      </motion.button>

      {open && <TaskDetailDrawer task={open} onClose={() => { setOpen(null); if (taskParam) setParams((p) => { const n = new URLSearchParams(p); n.delete("task"); return n; }, { replace: true }); }} />}
      {aiOpen && <AiCreateModal onClose={() => setAiOpen(false)} />}
      {newOpen && <NewRequirementModal onClose={() => setNewOpen(false)} />}
    </div>
  );
}
