// 采购个人工作台：成员视角，只看「分配给我」的任务（对标研发个人工作台）。
// 复用驾驶舱的任务卡 / 动作体系 / 详情抽屉，按流程阶段分组，卡片上直接推进下一步。
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  AlertTriangle,
  ArrowUpRight,
  Beaker,
  ClipboardList,
  PackageCheck,
  Search,
  ShoppingCart,
  Truck,
  X,
} from "lucide-react";
import { useNavigate } from "react-router";
import { useAuth } from "../auth";
import { Input } from "../components/ui/input";
import { Button } from "../components/ui/button";
import { useI18n } from "../lib/i18n";
import { routePath } from "../lib/routePaths";
import { daysFromToday, isProcurementTaskOverdue, refreshProcurement, useProcurementData, type ProcStatus, type ProcurementTask } from "./data";
import { StatCell } from "./components/common";
import { isProcurementTaskAssignedToUser } from "./procurementLogic";
import { ProcurementTaskCard } from "./components/ProcurementTaskCard";
import { TaskDetailDrawer } from "./components/TaskDetailDrawer";
import { useProcTaskAction } from "./components/taskActions";

const TERMINAL: ProcStatus[] = ["completed", "cancelled"];
const TRANSIT: ProcStatus[] = ["in_transit", "partial_arrival"];

/** 流程阶段分组：非空才渲染，顺序即处理优先级。 */
const STAGES: Array<{ label: string; statuses: ProcStatus[]; Icon: typeof ClipboardList }> = [
  { label: "待研发审核", statuses: ["pending_rd_review"], Icon: ClipboardList },
  { label: "待处理", statuses: ["pending_confirm"], Icon: ClipboardList },
  { label: "询价阶段", statuses: ["pending_inquiry", "inquiring"], Icon: Search },
  { label: "打样测试", statuses: ["pending_sample", "testing"], Icon: Beaker },
  { label: "待下单", statuses: ["priced", "pending_purchase"], Icon: ShoppingCart },
  { label: "在途到货", statuses: ["in_transit", "partial_arrival"], Icon: Truck },
];

type StatKey = "active" | "pending" | "overdue" | "week";
const STAT_LABELS: Record<StatKey, string> = {
  active: "全部进行中任务",
  pending: "待处理",
  overdue: "已逾期",
  week: "本周到货",
};

function isProcurementTaskArrivingThisWeek(task: ProcurementTask) {
  const days = daysFromToday(task.expectedArrivalDate);
  return TRANSIT.includes(task.status) && days != null && days >= 0 && days <= 7;
}

export function ProcMyWorkspacePage() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { tasks, materials, loading, error } = useProcurementData();
  const [open, setOpen] = useState<ProcurementTask | null>(null);
  const [detailAction, setDetailAction] = useState<"rollback" | "logs" | undefined>();
  const [stat, setStat] = useState<StatKey | null>(null);
  const [query, setQuery] = useState("");
  const pageRef = useRef<HTMLDivElement>(null);
  const openDetail = (task: ProcurementTask, action?: "rollback" | "logs") => {
    setDetailAction(action);
    setOpen(task);
  };
  const taskAction = useProcTaskAction({ onOpenDetail: (task) => openDetail(task) });
  const isInitialLoading = loading && tasks.length === 0;

  // 我的任务：优先按 buyerUserId 精确匹配，回退姓名（兼容仅按姓名指派的历史任务）
  const mine = useMemo(
    () => tasks.filter((task) => isProcurementTaskAssignedToUser(task, user)),
    [tasks, user?.id, user?.name],
  );
  const active = useMemo(() => mine.filter((task) => !TERMINAL.includes(task.status)), [mine]);

  // 逾期口径与驾驶舱、人员管理一致：Deadline/需求日期/预计到货随阶段切换。
  const counts = useMemo(() => ({
    active: active.length,
    pending: active.filter((task) => task.status === "pending_confirm").length,
    overdue: active.filter(isProcurementTaskOverdue).length,
    week: active.filter(isProcurementTaskArrivingThisWeek).length,
  }), [active]);

  const filtered = useMemo(() => {
    let scoped = !stat || stat === "active"
      ? active
      : stat === "pending"
        ? active.filter((task) => task.status === "pending_confirm")
        : stat === "overdue"
          ? active.filter(isProcurementTaskOverdue)
          : active.filter(isProcurementTaskArrivingThisWeek);
    const keyword = query.trim().toLowerCase();
    if (keyword) {
      scoped = scoped.filter((task) => [
        task.code,
        task.materialName,
        task.spec,
        task.buyer,
        task.rdContact,
        task.rdTaskTitle,
        task.consumableNote,
      ].some((value) => value?.toLowerCase().includes(keyword)));
    }
    return scoped;
  }, [active, query, stat]);

  const stageGroups = useMemo(
    () => STAGES.flatMap((stage) => {
      const stageTasks = filtered.filter((task) => stage.statuses.includes(task.status));
      return stageTasks.length > 0 ? [{ ...stage, tasks: stageTasks }] : [];
    }),
    [filtered],
  );

  // 操作后数据刷新，已打开的抽屉跟着换成最新对象
  useEffect(() => {
    setOpen((cur) => (cur ? tasks.find((task) => task.id === cur.id) ?? null : cur));
  }, [tasks]);

  const resetScroll = () => {
    const scrollRoot = pageRef.current?.closest("main");
    if (scrollRoot) scrollRoot.scrollTop = 0;
  };
  const toggleStat = (key: StatKey) => {
    setStat((cur) => (key === "active" || cur === key ? null : key));
    resetScroll();
  };
  const changeQuery = (value: string) => {
    setQuery(value);
    resetScroll();
  };
  const hasFilters = Boolean(stat || query.trim());
  const clearFilters = () => {
    setStat(null);
    setQuery("");
    resetScroll();
  };

  return (
    <div ref={pageRef} className="proc-horizon proc-workspace-page mx-auto min-w-0 w-full max-w-[1600px] pb-4">
      <div className="proc-workspace-intro mb-3 flex min-w-0 flex-wrap items-center justify-between gap-3">
        <p className="min-w-0 text-pretty text-sm text-slate-600">{t("按流程阶段推进分配给你的采购任务。")}</p>
        {active.length > 0 ? <Button type="button" variant="outline" size="sm" onClick={() => navigate(routePath("page:proc-cockpit", "/proc-cockpit"))} className="shrink-0">
          {t("查看采购驾驶舱")}<ArrowUpRight aria-hidden="true" className="size-4" />
        </Button> : null}
      </div>

      {/* 我的统计：点击筛选 */}
      <div role="group" aria-label={t("我的采购任务概览")} className="proc-workspace-stats proc-horizon-kpi-grid proc-horizon-surface mb-3 grid grid-cols-2 gap-0 p-2">
        <StatCell label={t("进行中")} value={isInitialLoading ? "—" : counts.active} Icon={Activity} active={!stat || stat === "active"} onClick={() => toggleStat("active")} />
        <StatCell label={t("待处理")} value={isInitialLoading ? "—" : counts.pending} tone={counts.pending > 0 ? "red" : "slate"} badge={counts.pending > 0} Icon={ClipboardList} active={stat === "pending"} onClick={() => toggleStat("pending")} />
        <StatCell label={t("已逾期")} value={isInitialLoading ? "—" : counts.overdue} tone="red" badge={counts.overdue > 0} Icon={AlertTriangle} active={stat === "overdue"} onClick={() => toggleStat("overdue")} />
        <StatCell label={t("本周到货")} value={isInitialLoading ? "—" : counts.week} tone="emerald" Icon={PackageCheck} active={stat === "week"} onClick={() => toggleStat("week")} />
      </div>

      <section aria-label={t("我的采购任务筛选")} className="proc-workspace-filters mb-3 flex min-w-0 flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white p-3">
        <div className="proc-workspace-search relative min-w-0 flex-1">
          <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
          <Input
            value={query}
            onChange={(event) => changeQuery(event.target.value)}
            aria-label={t("搜索我的采购任务")}
            placeholder={t("搜索单号、物料、规格或负责人")}
            className="h-10 pl-9 pr-9 text-sm"
          />
          {query ? (
            <button
              type="button"
              onClick={() => changeQuery("")}
              aria-label={t("清空搜索")}
              className="absolute right-2 top-1/2 flex size-7 -translate-y-1/2 items-center justify-center rounded-md text-slate-400 hover:bg-slate-100 hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
            >
              <X aria-hidden="true" className="size-3.5" />
            </button>
          ) : null}
        </div>
        <div className="proc-workspace-filter-result flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2 text-xs text-slate-500">
          <span className="font-medium text-slate-700">{t(STAT_LABELS[stat ?? "active"])}</span>
          <span aria-live="polite" className="tabular-nums">{isInitialLoading ? t("正在加载我的采购任务") : t("显示 {count} 个任务", { count: filtered.length })}</span>
          {hasFilters ? (
            <button type="button" onClick={clearFilters} className="rounded-md px-2 py-1 font-semibold text-primary hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40">
              {t("清除筛选")}
            </button>
          ) : null}
        </div>
      </section>

      {error ? (
        <div role="alert" className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-rose-200 bg-rose-50/40 px-4 py-12 text-center text-sm text-rose-700">
          <AlertTriangle aria-hidden="true" className="size-7 text-rose-500" />
          <div className="min-w-0">
            <p className="text-balance font-semibold">{t("我的采购任务加载失败")}</p>
            <p className="mt-1 max-w-xl break-words text-pretty text-sm text-rose-600">{error}</p>
          </div>
          <button type="button" onClick={() => void refreshProcurement()} className="material-button-secondary px-3 py-2 text-xs">{t("重新加载")}</button>
        </div>
      ) : isInitialLoading ? (
        <div role="status" aria-label={t("正在加载我的采购任务")} className="proc-workspace-task-grid grid grid-cols-1 gap-3">
          {[0, 1, 2].map((item) => (
            <div key={item} className="min-h-52 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className="flex gap-2"><span className="h-5 w-16 rounded bg-slate-100" /><span className="h-5 w-20 rounded bg-slate-100" /></div>
              <div className="mt-4 h-5 w-3/4 rounded bg-slate-100" />
              <div className="mt-3 h-4 w-full rounded bg-slate-100" />
              <div className="mt-2 h-4 w-2/3 rounded bg-slate-100" />
              <div className="mt-8 h-2 w-full rounded bg-slate-100" />
            </div>
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="proc-workspace-empty flex flex-col items-center gap-3 rounded-xl border border-dashed border-slate-200 bg-white px-4 py-16 text-center">
          <ClipboardList aria-hidden="true" className="size-7 text-slate-300" />
          <div className="min-w-0">
            <p className="text-balance text-sm font-semibold text-slate-700">{t(active.length === 0 ? "当前没有需要推进的采购任务" : "没有符合筛选条件的任务")}</p>
            <p className="mt-1 text-pretty text-sm text-slate-500">{t(active.length === 0 ? "分配给你的未完成任务会显示在这里。" : "试试其他状态，或修改搜索条件。")}</p>
          </div>
          {active.length === 0 ? (
            <button type="button" onClick={() => navigate(routePath("page:proc-cockpit", "/proc-cockpit"))} className="material-button-secondary px-3 py-2 text-xs">{t("查看采购驾驶舱")}</button>
          ) : (
            <button type="button" onClick={clearFilters} className="material-button-secondary px-3 py-2 text-xs">{t("清除筛选")}</button>
          )}
        </div>
      ) : (
        <div className="proc-horizon-workspace-surface">
          {stageGroups.map((stage) => {
            const StageIcon = stage.Icon;
            return (
              <section key={stage.label} aria-labelledby={`proc-workspace-stage-${stage.statuses[0]}`} className="proc-horizon-workspace-stage">
                <h2 id={`proc-workspace-stage-${stage.statuses[0]}`} className="proc-horizon-stage-title mb-3 flex flex-wrap items-center gap-2 text-balance text-sm font-bold text-slate-700">
                  <StageIcon className="size-4 shrink-0 text-slate-400" aria-hidden="true" />
                  {t(stage.label)}
                  <span className="rounded-full bg-slate-100 px-2 text-[11px] font-medium tabular-nums text-slate-500">{stage.tasks.length}</span>
                </h2>
                <div className="proc-workspace-task-grid grid grid-cols-1 items-start gap-3">
                  {stage.tasks.map((task) => (
                    <ProcurementTaskCard
                      key={task.id}
                      task={task}
                      materials={materials}
                      onOpen={(task) => openDetail(task)}
                      onRollback={(task) => openDetail(task, "rollback")}
                      onViewLogs={(task) => openDetail(task, "logs")}
                      onNext={(x) => taskAction.runNext(x, "card")}
                      onReassign={taskAction.reassign}
                      onRemove={taskAction.remove}
                    />
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      )}

      {open && <TaskDetailDrawer key={open.id} task={open} initialAction={detailAction} onClose={() => { setOpen(null); setDetailAction(undefined); }} />}
      {taskAction.modal}
    </div>
  );
}
