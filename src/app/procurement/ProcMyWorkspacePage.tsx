// 采购个人工作台：成员视角，只看「分配给我」的任务（对标研发个人工作台）。
// 复用驾驶舱的任务卡 / 动作体系 / 详情抽屉，按流程阶段分组，卡片上直接推进下一步。
import { useEffect, useMemo, useState } from "react";
import { Activity, AlertTriangle, ClipboardList, GanttChartSquare, PackageCheck } from "lucide-react";
import { useAuth } from "../auth";
import { useI18n } from "../lib/i18n";
import { daysFromToday, taskMainDate, useProcurementData, type ProcStatus, type ProcurementTask } from "./data";
import { PageHeader, StatCell } from "./components/common";
import { ProcurementTaskCard } from "./components/ProcurementTaskCard";
import { TaskDetailDrawer } from "./components/TaskDetailDrawer";
import { useProcTaskAction } from "./components/taskActions";

const TERMINAL: ProcStatus[] = ["completed", "cancelled"];
const TRANSIT: ProcStatus[] = ["in_transit", "partial_arrival"];

/** 流程阶段分组：非空才渲染，顺序即处理优先级。 */
const STAGES: Array<{ label: string; statuses: ProcStatus[] }> = [
  { label: "待处理", statuses: ["pending_confirm"] },
  { label: "询价阶段", statuses: ["pending_inquiry", "inquiring"] },
  { label: "打样测试", statuses: ["pending_sample", "testing"] },
  { label: "待下单", statuses: ["priced", "pending_purchase"] },
  { label: "在途到货", statuses: ["in_transit", "partial_arrival"] },
];

type StatKey = "active" | "pending" | "overdue" | "week";

export function ProcMyWorkspacePage() {
  const { t } = useI18n();
  const { user } = useAuth();
  const { tasks, loading, error } = useProcurementData();
  const [open, setOpen] = useState<ProcurementTask | null>(null);
  const [stat, setStat] = useState<StatKey | null>(null);
  const taskAction = useProcTaskAction({ onOpenDetail: setOpen });

  // 我的任务：优先按 buyerUserId 精确匹配，回退姓名（兼容仅按姓名指派的历史任务）
  const mine = useMemo(
    () => tasks.filter((task) =>
      (task.buyerUserId && user?.id && task.buyerUserId === user.id) ||
      (Boolean(task.buyer) && task.buyer === user?.name)),
    [tasks, user?.id, user?.name],
  );
  const active = useMemo(() => mine.filter((task) => !TERMINAL.includes(task.status)), [mine]);

  // 逾期口径取主日期（Deadline/需求日期/预计到货随阶段切换），个人视角比驾驶舱的「在途逾期」更全面
  const isOverdue = (task: ProcurementTask) => (taskMainDate(task).days ?? 99) < 0;
  const isThisWeek = (task: ProcurementTask) => {
    const d = daysFromToday(task.expectedArrivalDate);
    return TRANSIT.includes(task.status) && d != null && d >= 0 && d <= 7;
  };

  const counts = useMemo(() => ({
    active: active.length,
    pending: active.filter((task) => task.status === "pending_confirm").length,
    overdue: active.filter(isOverdue).length,
    week: active.filter(isThisWeek).length,
  }), [active]);

  const filtered = useMemo(() => {
    if (!stat || stat === "active") return active;
    if (stat === "pending") return active.filter((task) => task.status === "pending_confirm");
    if (stat === "overdue") return active.filter(isOverdue);
    return active.filter(isThisWeek);
  }, [active, stat]);

  // 操作后数据刷新，已打开的抽屉跟着换成最新对象
  useEffect(() => {
    setOpen((cur) => (cur ? tasks.find((task) => task.id === cur.id) ?? null : cur));
  }, [tasks]);

  const toggleStat = (key: StatKey) => setStat((cur) => (cur === key ? null : key));

  return (
    <div className="mx-auto w-full max-w-[1600px] p-4">
      <PageHeader
        Icon={GanttChartSquare}
        badge={t("采购管理")}
        title={t("个人工作台")}
        description={t("只看分配给我的采购任务：按流程阶段分组，卡片上直接推进下一步。")}
      />

      {/* 我的统计：点击筛选 */}
      <div className="mb-3 grid grid-cols-4 gap-3">
        <StatCell label={t("进行中")} value={counts.active} Icon={Activity} active={stat === "active"} onClick={() => toggleStat("active")} />
        <StatCell label={t("待处理")} value={counts.pending} tone={counts.pending > 0 ? "red" : "slate"} badge={counts.pending > 0} Icon={ClipboardList} active={stat === "pending"} onClick={() => toggleStat("pending")} />
        <StatCell label={t("已逾期")} value={counts.overdue} tone="red" badge={counts.overdue > 0} Icon={AlertTriangle} active={stat === "overdue"} onClick={() => toggleStat("overdue")} />
        <StatCell label={t("本周到货")} value={counts.week} tone="emerald" Icon={PackageCheck} active={stat === "week"} onClick={() => toggleStat("week")} />
      </div>

      {error ? (
        <div className="rounded-xl border border-dashed border-red-200 bg-red-50/40 py-12 text-center text-sm text-red-500">{error}</div>
      ) : loading && tasks.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-200 py-12 text-center text-sm text-slate-400">{t("加载中")}…</div>
      ) : filtered.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-200 py-16 text-center">
          <p className="text-sm text-slate-400">{t(active.length === 0 ? "当前没有分配给你的采购任务" : "没有符合筛选条件的任务")}</p>
        </div>
      ) : (
        <div className="space-y-5">
          {STAGES.map((stage) => {
            const list = filtered.filter((task) => stage.statuses.includes(task.status));
            if (list.length === 0) return null;
            return (
              <section key={stage.label}>
                <h2 className="mb-2 flex items-center gap-2 text-sm font-bold text-slate-700">
                  {t(stage.label)}
                  <span className="rounded-full bg-slate-100 px-2 text-[11px] font-medium tabular-nums text-slate-500">{list.length}</span>
                </h2>
                <div className="grid grid-cols-3 items-start gap-3">
                  {list.map((task) => (
                    <ProcurementTaskCard
                      key={task.id}
                      task={task}
                      onOpen={setOpen}
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

      {open && <TaskDetailDrawer task={open} onClose={() => setOpen(null)} />}
      {taskAction.modal}
    </div>
  );
}
