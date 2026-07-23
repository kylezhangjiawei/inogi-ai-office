// 采购任务驾驶舱（流程视角）：业务线 Tab + 操作行 + 统计条 + 人员泳道 + 三列瀑布流。
// 分类/物料维度的浏览在「物料库」页，此页专注任务流。
import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router";
import { Activity, AlertTriangle, ClipboardList, Download, PackageCheck, Plus, Search, Truck, UserCog, Users } from "lucide-react";
import { cn } from "../components/ui/utils";
import { AutoTranslatedText } from "../components/TranslatableText";
import { useI18n } from "../lib/i18n";
import { toast } from "sonner";
import { daysFromToday, taskMainDate, taskRequester, useProcurementData, type ProcStatus, type ProcurementTask } from "./data";
import { PersonAvatar, StatCell } from "./components/common";
import { ProcurementTaskCard } from "./components/ProcurementTaskCard";
import { useProcTaskAction } from "./components/taskActions";
import { TaskDetailDrawer } from "./components/TaskDetailDrawer";
import { BatchReassignModal, NewRequirementModal } from "./components/modals";
import { PeopleManageDrawer } from "./components/PeopleManageDrawer";
import { usePermission } from "../hooks/usePermission";
import { exportProcTasksXlsx } from "./exportTasks";

const ACTIVE_STATUSES: ProcStatus[] = ["pending_confirm", "pending_inquiry", "inquiring", "pending_sample", "testing", "priced", "pending_purchase", "in_transit", "partial_arrival"];
const TRANSIT_STATUSES: ProcStatus[] = ["in_transit", "partial_arrival"];
/** 瀑布流每批渲染数量（约一屏三列），滚动到底自动追加 */
const WATERFALL_PAGE_SIZE = 9;

type StatKey = "inprogress" | "pending" | "inquiring" | "transit" | "overdue" | "week";

export function ProcurementCockpitPage() {
  const { t } = useI18n();
  const { tasks, loading, error } = useProcurementData();
  const [params, setParams] = useSearchParams();
  const [open, setOpen] = useState<ProcurementTask | null>(null);
  const [stat, setStat] = useState<StatKey | null>(null);
  const [person, setPerson] = useState<string | null>(null);
  const [newOpen, setNewOpen] = useState(false);
  const [batchOpen, setBatchOpen] = useState(false);
  const [peopleOpen, setPeopleOpen] = useState(false);
  const [kw, setKw] = useState("");
  // 写操作按钮按系统管理配置的操作码显隐；物料审核在工作台物料详情里做（带完整上下文）
  const canCreate = usePermission("proc-task:create");
  const canReassign = usePermission("proc-task:reassign");
  // 决策类动作（选定报价 / 测试结论）在卡片上点只打开详情，由详情提供报价与图纸依据。
  // 必须声明在 setOpen 之后——放前面会命中 TDZ，构建器不报错但运行时直接白屏。
  const taskAction = useProcTaskAction({ onOpenDetail: setOpen });

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

  // 操作后数据刷新，已打开的抽屉要跟着换成最新对象（否则状态停在操作前）
  useEffect(() => {
    setOpen((cur) => (cur ? tasks.find((x) => x.id === cur.id) ?? null : cur));
  }, [tasks]);

  const isOverdue = (t: ProcurementTask) => TRANSIT_STATUSES.includes(t.status) && (daysFromToday(t.expectedArrivalDate) ?? 99) < 0;
  const isThisWeek = (t: ProcurementTask) => { const d = daysFromToday(t.expectedArrivalDate); return TRANSIT_STATUSES.includes(t.status) && d != null && d >= 0 && d <= 7; };

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
    const keyword = kw.trim().toLowerCase();
    if (keyword) list = list.filter((t) => `${t.code} ${t.materialName} ${t.spec} ${t.buyer} ${t.rdContact ?? ""} ${taskRequester(t).name}`.toLowerCase().includes(keyword));
    // 待处理置顶；其余按主日期升序
    return [...list].sort((a, b) => {
      if ((a.status === "pending_confirm") !== (b.status === "pending_confirm")) return a.status === "pending_confirm" ? -1 : 1;
      const da = taskMainDate(a).date ?? "9999";
      const db = taskMainDate(b).date ?? "9999";
      return da.localeCompare(db);
    });
  }, [lineTasks, stat, person, materialParam, kw]);

  const toggleStat = (k: StatKey) => setStat((cur) => (cur === k ? null : k));

  // 瀑布流分批渲染：首屏一批，滚动到底部哨兵自动追加；筛选条件变化重置
  const [visibleCount, setVisibleCount] = useState(WATERFALL_PAGE_SIZE);
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => { setVisibleCount(WATERFALL_PAGE_SIZE); }, [line, person, stat, materialParam, kw]);
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
    <div className="mx-auto flex h-full w-full max-w-[1600px] flex-col p-4">
      {/* 页头（业务线 Tab + 操作按钮）/ 统计条 / 人员泳道 */}
      <div className="material-card mb-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-3 py-2">
        <div className="inline-flex items-center gap-1 rounded-lg bg-slate-100 p-1">
          {([["all", "全部"], ["production", "生产"], ["rd", "研发"]] as const).map(([k, lbl]) => (
            <button key={k} type="button" onClick={() => setLine(k)} className={cn("flex items-center gap-1.5 rounded-md px-4 py-1.5 text-sm transition", line === k ? "bg-white font-semibold text-indigo-700 shadow-sm" : "font-medium text-slate-500 hover:text-slate-700")}>
              {t(lbl)}
              <span className={cn("rounded-full px-1.5 text-[11px] font-medium tabular-nums", line === k ? "bg-indigo-50 text-indigo-600" : "bg-slate-200/70 text-slate-500")}>{lineCounts[k]}</span>
            </button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            title={t('导出当前筛选下的任务列表（Excel）')}
            onClick={() => {
              void exportProcTasksXlsx(filtered)
                .then((count) => toast.success(t('已导出 {count} 个任务', { count })))
                .catch((err) => toast.error(err instanceof Error ? err.message : t('导出失败')));
            }}
            className="material-button-secondary inline-flex items-center gap-1.5 px-3 py-1.5 text-sm"
          ><Download className="h-4 w-4" />{t('导出')}</button>
          {canReassign && <button type="button" onClick={() => setBatchOpen(true)} className="material-button-secondary inline-flex items-center gap-1.5 px-3 py-1.5 text-sm"><Users className="h-4 w-4" />{t('批量转派')}</button>}
          <button type="button" onClick={() => setPeopleOpen(true)} className="material-button-secondary inline-flex items-center gap-1.5 px-3 py-1.5 text-sm"><UserCog className="h-4 w-4" />{t('人员管理')}</button>
          {canCreate && <button type="button" onClick={() => setNewOpen(true)} className="material-button-secondary inline-flex items-center gap-1.5 px-3 py-1.5 text-sm"><Plus className="h-4 w-4" />{t('新建需求')}</button>}
        </div>
      </div>

      {/* 统计条 */}
      <div className="mb-3 grid grid-cols-6 gap-3">
        <StatCell label={t('进行中')} value={counts.inprogress} Icon={Activity} active={stat === "inprogress"} onClick={() => toggleStat("inprogress")} />
        <StatCell label={t('待处理')} value={counts.pending} tone={counts.pending > 0 ? "red" : "slate"} badge={counts.pending > 0} Icon={ClipboardList} active={stat === "pending"} onClick={() => toggleStat("pending")} />
        <StatCell label={t('询价中')} value={counts.inquiring} tone="indigo" Icon={Search} active={stat === "inquiring"} onClick={() => toggleStat("inquiring")} />
        <StatCell label={t('在途')} value={counts.transit} tone="violet" Icon={Truck} active={stat === "transit"} onClick={() => toggleStat("transit")} />
        <StatCell label={t('逾期')} value={counts.overdue} tone="red" Icon={AlertTriangle} active={stat === "overdue"} onClick={() => toggleStat("overdue")} />
        <StatCell label={t('本周到货')} value={counts.week} tone="emerald" Icon={PackageCheck} active={stat === "week"} onClick={() => toggleStat("week")} />
      </div>

      {/* 人员泳道 */}
      <div className="material-card mb-3 flex flex-wrap items-center gap-2 px-4 py-3">
        <span className="mr-1 text-xs text-slate-400">{t('人员')}</span>
        <button type="button" onClick={() => setPerson(null)} className={cn("rounded-full border px-2.5 py-1 text-xs font-medium", !person ? "border-indigo-300 bg-indigo-50 text-indigo-600" : "border-slate-200 text-slate-500 hover:bg-slate-50")}>{t('全部')}</button>
        {people.map(([name, n]) => (
          <button key={name} type="button" onClick={() => setPerson((cur) => (cur === name ? null : name))} className={cn("flex items-center gap-1.5 rounded-full border py-0.5 pl-0.5 pr-2 text-xs font-medium", person === name ? "border-indigo-300 bg-indigo-50 text-indigo-600" : "border-slate-200 text-slate-600 hover:bg-slate-50")}>
            <PersonAvatar name={name} size="xs" />
            {name}
            <span className="rounded-full bg-slate-100 px-1.5 text-[10px] text-slate-500">{n}</span>
          </button>
        ))}
        {materialParam && (
          <button type="button" onClick={() => setParams((p) => { const n = new URLSearchParams(p); n.delete("material"); return n; }, { replace: true })} className="rounded-full border border-indigo-200 bg-indigo-50 px-2 py-0.5 text-xs text-indigo-600">{t('物料')}：<AutoTranslatedText text={materialParam} /> ✕</button>
        )}
        <div className="ml-auto flex items-center gap-2">
          <div className="flex items-center gap-1.5 rounded-lg border border-slate-200 px-2 py-1 text-xs">
            <Search className="h-3.5 w-3.5 text-slate-400" />
            <input value={kw} onChange={(e) => setKw(e.target.value)} placeholder={t('搜索单号 / 物料 / 人员')} className="w-40 bg-transparent outline-none placeholder:text-slate-400" />
            {kw && <button type="button" onClick={() => setKw("")} className="text-slate-400 hover:text-slate-600">✕</button>}
          </div>
          <span className="text-xs text-slate-400">{filtered.length} {t('个任务')}</span>
        </div>
      </div>

      {/* 任务展示区：头部固定、这里 flex-1 + min-h-0 自身内滚，避免撑高外层 <main> 出现整页滚动条。 */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div>
          {error ? (
            <div className="rounded-xl border border-dashed border-red-200 bg-red-50/40 py-12 text-center text-sm text-red-500">{error}</div>
          ) : loading && tasks.length === 0 ? (
            <div className="rounded-xl border border-dashed border-slate-200 py-12 text-center text-sm text-slate-400">{t('加载中')}…</div>
          ) : filtered.length === 0 ? (
            <div className="rounded-xl border border-dashed border-slate-200 py-12 text-center text-sm text-slate-400">{t('没有符合条件的任务')}</div>
          ) : (
              <>
                {/* 瀑布流：CSS 多列实现（待处理置顶项落在第一列顶部）；分批渲染 + 滚动加载更多 */}
                <div className="columns-3 gap-3">
                  {visibleTasks.map((t) => (
                    <div key={t.id} className="mb-3 break-inside-avoid">
                      <ProcurementTaskCard
                        task={t}
                        onOpen={setOpen}
                        onNext={(task) => taskAction.runNext(task, "card")}
                        onReassign={taskAction.reassign}
                        onRemove={taskAction.remove}
                      />
                    </div>
                  ))}
                </div>
                {visibleCount < filtered.length ? (
                  <div ref={sentinelRef} className="flex items-center justify-center gap-2 py-4 text-xs text-slate-400">
                    <span className="h-3 w-3 animate-spin rounded-full border-2 border-slate-300 border-t-indigo-500" />
                    {t('下拉加载更多')}（{visibleCount} / {filtered.length}）
                  </div>
                ) : filtered.length > WATERFALL_PAGE_SIZE ? (
                  <div className="py-4 text-center text-xs text-slate-300">{t('已加载全部')} {filtered.length} {t('个任务')}</div>
                ) : null}
              </>
            )}
        </div>
      </div>

      {open && <TaskDetailDrawer task={open} onClose={() => { setOpen(null); if (taskParam) setParams((p) => { const n = new URLSearchParams(p); n.delete("task"); return n; }, { replace: true }); }} />}
      {taskAction.modal}
      {newOpen && <NewRequirementModal onClose={() => setNewOpen(false)} />}
      {batchOpen && <BatchReassignModal tasks={lineTasks} onClose={() => setBatchOpen(false)} />}
      {peopleOpen && <PeopleManageDrawer onClose={() => setPeopleOpen(false)} onFocusPerson={setPerson} />}
    </div>
  );
}
