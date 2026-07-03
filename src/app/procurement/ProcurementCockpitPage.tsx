// 采购任务驾驶舱（流程视角）：统计条 + 操作行 + 人员泳道 + 三列瀑布流 + 右侧到货付款速览。
import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router";
import { Activity, AlertTriangle, ClipboardList, Download, PackageCheck, Plus, Search, ShoppingCart, Sparkles, Truck, Users } from "lucide-react";
import { cn } from "../components/ui/utils";
import { PROCUREMENT_TASKS, daysFromDemoToday, taskMainDate, type ProcStatus, type ProcurementTask } from "../../mock/procurement";
import { PageHeader, PersonAvatar, StatCell, stageToast } from "./components/common";
import { ProcurementTaskCard } from "./components/ProcurementTaskCard";
import { TaskDetailDrawer } from "./components/TaskDetailDrawer";
import { AiCreateModal, ArrivalPreviewPanel, NewRequirementModal } from "./components/modals";

const ACTIVE_STATUSES: ProcStatus[] = ["pending_confirm", "pending_inquiry", "inquiring", "pending_sample", "testing", "priced", "pending_purchase", "in_transit", "partial_arrival"];
const TRANSIT_STATUSES: ProcStatus[] = ["in_transit", "partial_arrival"];

type StatKey = "inprogress" | "pending" | "inquiring" | "transit" | "overdue" | "week";

export function ProcurementCockpitPage() {
  const tasks = PROCUREMENT_TASKS;
  const [params, setParams] = useSearchParams();
  const [open, setOpen] = useState<ProcurementTask | null>(null);
  const [stat, setStat] = useState<StatKey | null>(null);
  const [person, setPerson] = useState<string | null>(null);
  const [line, setLine] = useState<"all" | "rd" | "production">("all");
  const [aiOpen, setAiOpen] = useState(false);
  const [newOpen, setNewOpen] = useState(false);

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

  const counts = useMemo(() => ({
    inprogress: tasks.filter((t) => ACTIVE_STATUSES.includes(t.status)).length,
    pending: tasks.filter((t) => t.status === "pending_confirm").length,
    inquiring: tasks.filter((t) => t.status === "inquiring").length,
    transit: tasks.filter((t) => TRANSIT_STATUSES.includes(t.status)).length,
    overdue: tasks.filter(isOverdue).length,
    week: tasks.filter(isThisWeek).length,
  }), [tasks]);

  // 人员泳道维度：采购负责人 + 研发对接人
  const people = useMemo(() => {
    const m = new Map<string, number>();
    for (const t of tasks) {
      m.set(t.buyer, (m.get(t.buyer) ?? 0) + 1);
      if (t.rdContact) m.set(t.rdContact, (m.get(t.rdContact) ?? 0) + 1);
    }
    return Array.from(m.entries());
  }, [tasks]);

  const filtered = useMemo(() => {
    let list = tasks.filter((t) => {
      if (!stat) return true;
      if (stat === "inprogress") return ACTIVE_STATUSES.includes(t.status);
      if (stat === "pending") return t.status === "pending_confirm";
      if (stat === "inquiring") return t.status === "inquiring";
      if (stat === "transit") return TRANSIT_STATUSES.includes(t.status);
      if (stat === "overdue") return isOverdue(t);
      if (stat === "week") return isThisWeek(t);
      return true;
    });
    if (person) list = list.filter((t) => t.buyer === person || t.rdContact === person);
    if (line !== "all") list = list.filter((t) => t.businessLine === line);
    if (materialParam) list = list.filter((t) => t.materialName === materialParam);
    // 待处理置顶；其余按主日期升序
    return [...list].sort((a, b) => {
      if ((a.status === "pending_confirm") !== (b.status === "pending_confirm")) return a.status === "pending_confirm" ? -1 : 1;
      const da = taskMainDate(a).date ?? "9999";
      const db = taskMainDate(b).date ?? "9999";
      return da.localeCompare(db);
    });
  }, [tasks, stat, person, line, materialParam]);

  const toggleStat = (k: StatKey) => setStat((cur) => (cur === k ? null : k));

  return (
    <div className="mx-auto w-full max-w-[1600px] p-4">
      <PageHeader
        Icon={ShoppingCart}
        badge="采购管理"
        title="采购任务驾驶舱"
        description="从研发流转与采购自建的全流程视角管理采购任务：询价、打样、测试、下单、到货。"
        right={
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={stageToast} className="material-button-secondary inline-flex items-center gap-1.5 px-3 py-2 text-sm"><Download className="h-4 w-4" />导出</button>
            <button type="button" onClick={() => setAiOpen(true)} className="material-button-primary inline-flex items-center gap-1.5 px-3 py-2 text-sm"><Sparkles className="h-4 w-4" />AI 建单</button>
            <button type="button" onClick={stageToast} className="material-button-secondary inline-flex items-center gap-1.5 px-3 py-2 text-sm"><Users className="h-4 w-4" />批量转派</button>
            <button type="button" onClick={() => setNewOpen(true)} className="material-button-secondary inline-flex items-center gap-1.5 px-3 py-2 text-sm"><Plus className="h-4 w-4" />新建需求</button>
          </div>
        }
      />

      {/* 统计条 */}
      <div className="mb-3 grid grid-cols-6 gap-3">
        <StatCell label="进行中" value={counts.inprogress} Icon={Activity} active={stat === "inprogress"} onClick={() => toggleStat("inprogress")} />
        <StatCell label="待处理" value={counts.pending} tone={counts.pending > 0 ? "red" : "slate"} badge={counts.pending > 0} Icon={ClipboardList} active={stat === "pending"} onClick={() => toggleStat("pending")} />
        <StatCell label="询价中" value={counts.inquiring} tone="indigo" Icon={Search} active={stat === "inquiring"} onClick={() => toggleStat("inquiring")} />
        <StatCell label="在途" value={counts.transit} tone="violet" Icon={Truck} active={stat === "transit"} onClick={() => toggleStat("transit")} />
        <StatCell label="逾期" value={counts.overdue} tone="red" Icon={AlertTriangle} active={stat === "overdue"} onClick={() => toggleStat("overdue")} />
        <StatCell label="本周到货" value={counts.week} tone="emerald" Icon={PackageCheck} active={stat === "week"} onClick={() => toggleStat("week")} />
      </div>

      <div className="grid grid-cols-[1fr_320px] gap-3">
        <div>
          {/* 人员泳道 */}
          <div className="material-card mb-3 flex flex-wrap items-center gap-2 px-4 py-3">
            <span className="mr-1 text-xs text-slate-400">业务线</span>
            <div className="mr-2 inline-flex overflow-hidden rounded-lg border border-slate-200">
              {([["all", "全部"], ["rd", "研发"], ["production", "生产"]] as const).map(([k, lbl], i) => (
                <button key={k} type="button" onClick={() => setLine(k)} className={cn("px-3 py-1 text-xs font-medium transition", i > 0 && "border-l border-slate-200", line === k ? "bg-indigo-600 text-white" : "bg-white text-slate-500 hover:bg-slate-50")}>{lbl}</button>
              ))}
            </div>
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

          {/* 瀑布流 */}
          <div className="grid grid-cols-3 items-start gap-3">
            {filtered.length === 0 && <div className="col-span-3 rounded-xl border border-dashed border-slate-200 py-12 text-center text-sm text-slate-400">没有符合条件的任务</div>}
            {filtered.map((t) => <ProcurementTaskCard key={t.id} task={t} onOpen={setOpen} />)}
          </div>
        </div>

        <div className="space-y-3">
          <ArrivalPreviewPanel tasks={tasks} />
        </div>
      </div>

      {open && <TaskDetailDrawer task={open} onClose={() => { setOpen(null); if (taskParam) setParams((p) => { const n = new URLSearchParams(p); n.delete("task"); return n; }, { replace: true }); }} />}
      {aiOpen && <AiCreateModal onClose={() => setAiOpen(false)} />}
      {newOpen && <NewRequirementModal onClose={() => setNewOpen(false)} />}
    </div>
  );
}
