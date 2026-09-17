import { useMemo, useRef, useState } from "react";
import { ArrowLeft, ArrowUpRight, Search } from "lucide-react";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "../../components/ui/sheet";
import { useI18n } from "../../lib/i18n";
import type { ProcurementTask } from "../../lib/procurementApi";
import { getProcSampleFacts } from "../../lib/procSampleFacts";
import { TaskDetailDrawer } from "../components/TaskDetailDrawer";
import { PROC_STATUS_META } from "../components/common";
import { isSampleTask } from "../sampleWorkspaceModel";
import { personTaskNeedDate, personTaskNext, personTaskView, type PersonTaskBusiness, type PersonTaskFilters, type PersonTaskPeriod, type PersonTaskState } from "./personTaskModel";
import "./personTasks.css";
import { NativeSelect } from "../../components/ui/native-select";

function localMonth() {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

export function PersonTasksDrawer({ person, loading, error, onClose, onRetry, onRestoreFocus }: {
  person: { key: string; name: string; userId?: string; member: unknown; tasks: ProcurementTask[] } | null;
  loading: boolean; error: string | null; onClose: () => void; onRetry: () => void; onRestoreFocus: () => void;
}) {
  const { t } = useI18n();
  const [filters, setFilters] = useState<PersonTaskFilters>(() => ({ month: localMonth(), period: "month", business: "all", state: "all", query: "" }));
  const [limit, setLimit] = useState(20);
  const [detailId, setDetailId] = useState<string | null>(null);
  const switchingToDetail = useRef(false);
  const lastTaskId = useRef<string | null>(null);
  const listHeading = useRef<HTMLHeadingElement>(null);
  const taskButtons = useRef(new Map<string, HTMLButtonElement>());
  const view = useMemo(() => personTaskView(person?.tasks ?? [], filters), [person?.tasks, filters]);
  const blocked = loading || Boolean(error) || !person;
  const detail = !blocked && detailId ? person?.tasks.find((task) => task.id === detailId) : null;
  switchingToDetail.current = Boolean(detail);
  const patch = (next: Partial<PersonTaskFilters>) => { setFilters((current) => ({ ...current, ...next })); setLimit(20); };
  const showReminder = (period: "carryover" | "undated") => patch({ period, business: "all", state: "active", query: "" });
  const openDetail = (task: ProcurementTask) => {
    if (blocked || !person?.tasks.some((current) => current.id === task.id)) return;
    lastTaskId.current = task.id;
    switchingToDetail.current = true;
    setDetailId(task.id);
  };

  if (detail) return <TaskDetailDrawer key={detail.id} task={detail} onClose={() => { switchingToDetail.current = false; setDetailId(null); }} />;

  return <Sheet open onOpenChange={(open) => { if (!open) onClose(); }}>
    <SheetContent className="horizon-theme horizon-portal proc-person-tasks-drawer" onOpenAutoFocus={(event) => {
      event.preventDefault();
      (lastTaskId.current ? taskButtons.current.get(lastTaskId.current) : null)?.focus({ preventScroll: true });
      if (!lastTaskId.current || !taskButtons.current.get(lastTaskId.current)) listHeading.current?.focus({ preventScroll: true });
    }} onCloseAutoFocus={(event) => { event.preventDefault(); if (!switchingToDetail.current) onRestoreFocus(); }}>
      <SheetHeader className="border-b border-slate-100">
        <SheetTitle asChild><h2 ref={listHeading} tabIndex={-1} className="text-balance outline-none">{person ? t("{name} 的全部任务", { name: person.name }) : t("人员任务暂不可用")}</h2></SheetTitle>
        <SheetDescription className="text-pretty">{t("按需求日期归月，保留全部已读取任务。完整详情中的操作沿用原有权限。")}</SheetDescription>
        {person && !person.member && <p className="text-xs leading-5 text-slate-500">{t(person.key === "__unassigned__" ? "这些任务尚未指派采购负责人。" : person.userId ? "该人员不在当前名录，历史任务仍按账号保留。" : "历史任务缺少可唯一匹配的账号，请核对姓名归属。")}</p>}
      </SheetHeader>
      <div className="proc-person-tasks-body">
        <div className="proc-person-reminders" aria-label={t("人员任务独立提醒")}>
          {([["carryover", "跨月未完成", view.carryover.length], ["undated", "无有效需求日期", view.undated.length]] as const).map(([period, label, count]) => <Button variant="unstyled" type="button" key={period} disabled={blocked} onClick={() => showReminder(period)} className="proc-person-reminder">
            <span>{t(label)}</span><strong>{blocked ? "—" : count}</strong><span className="text-xs">{t("查看未完任务")} <ArrowUpRight className="inline size-3.5" /></span>
          </Button>)}
        </div>
        <p className="text-xs leading-5 text-slate-500">{t("以上提醒按该人员全部任务计算，搜索、业务分类和列表状态筛选不会隐藏。仓管与质量人员任务尚未纳入此采购来源。")}</p>
        <div className="proc-person-filters">
          <label>{t("需求月份")}<Input type="month" aria-label={t("人员任务需求月份")} value={filters.month} onChange={(event) => { if (/^\d{4}-(?:0[1-9]|1[0-2])$/.test(event.target.value)) patch({ month: event.target.value }); }} /></label>
          <label>{t("查看范围")}<NativeSelect aria-label={t("人员任务查看范围")} value={filters.period} onChange={(event) => patch({ period: event.target.value as PersonTaskPeriod })}><option value="month">{t("所选月任务")}</option><option value="all">{t("全部月份")}</option><option value="carryover">{t("跨月未完成")}</option><option value="undated">{t("无需求日期未完成")}</option></NativeSelect></label>
          <label>{t("任务状态")}<NativeSelect aria-label={t("人员任务状态")} value={filters.state} onChange={(event) => patch({ state: event.target.value as PersonTaskState })}><option value="all">{t("全部状态")}</option><option value="active">{t("进行中")}</option><option value="closed">{t("已结束")}</option></NativeSelect></label>
        </div>
        <div className="flex flex-wrap gap-2" role="group" aria-label={t("人员任务业务分类")}>{([["all", "全部业务"], ["purchase", "普通采购"], ["sample", "样品相关"]] as const).map(([value, label]) => <Button type="button" key={value} aria-pressed={filters.business === value} variant={filters.business === value ? "default" : "outline"} onClick={() => patch({ business: value as PersonTaskBusiness })}>{t(label)}</Button>)}</div>
        <p className="text-xs leading-5 text-slate-500">{t("样品相关指有样品要求或记录的原采购任务，包含历史测试，不等于当前待测试。")}</p>
        <div className="relative"><Search className="pointer-events-none absolute left-3 top-3 size-4 text-muted-foreground" /><Input aria-label={t("搜索该人员任务")} value={filters.query} placeholder={t("任务编号 / 物料 / 供应商 / 订单…")} onChange={(event) => patch({ query: event.target.value })} className="min-h-10 pl-9" /></div>
        {loading ? <p role="status" className="proc-person-task-notice">{t("正在读取人员任务，暂不计算数量…")}</p> : error ? <div role="alert" className="proc-person-task-notice"><p>{error}</p><p className="mt-1 text-xs">{t("来源读取失败，不能判断为零；重新读取成功后再查看任务。")}</p><Button type="button" variant="outline" onClick={onRetry} className="mt-3">{t("重新读取人员与任务")}</Button></div> : !person ? <p role="status" className="proc-person-task-notice">{t("此人员已不在当前可见范围，请关闭后重新选择。")}</p> : <>
          {detailId && !detail && <p role="status" className="proc-person-task-notice">{t("原任务已不在此人员名下或当前可见范围，请重新选择。")}</p>}
          <p role="status" className="text-xs tabular-nums text-slate-500">{t("筛选结果 {count} 项 · 该人员共 {total} 项，其中 {active} 项进行中", { count: view.tasks.length, total: view.total, active: view.active })}</p>
          {!view.tasks.length ? <div className="proc-person-task-notice"><p>{t("当前筛选下没有任务。可查看全部月份或清空搜索。")}</p><Button type="button" variant="outline" className="mt-3" onClick={() => patch({ period: "all", business: "all", state: "all", query: "" })}>{t("查看全部任务")}</Button></div> : <ul className="proc-person-task-list">{view.tasks.slice(0, limit).map((task) => {
            const meta = PROC_STATUS_META[task.status];
            const sample = isSampleTask(task);
            return <li key={task.id}>
              <div className="flex flex-wrap items-center justify-between gap-2"><span className="break-all text-xs tabular-nums text-slate-500">{task.code}</span><span className="rounded-full border border-slate-200 px-2 py-1 text-xs">{t(sample ? "样品相关" : "普通采购")}</span></div>
              <h3 className="mt-2 break-words text-pretty text-sm font-semibold">{task.materialName}</h3>
              <p className="mt-1 break-words text-xs text-slate-500">{task.spec || t("规格未提供")} · {Number.isFinite(task.quantity) && task.quantity >= 0 ? task.quantity.toLocaleString() : t("数量待核对")} {task.unit}</p>
              <dl className="proc-person-task-facts"><div><dt>{t("需求日期")}</dt><dd>{personTaskNeedDate(task) || t("待确认")}</dd></div><div><dt>{t("当前节点")}</dt><dd>{t(meta?.label || task.status)}</dd></div><div className="col-span-full"><dt>{t("下一步")}</dt><dd>{t(personTaskNext(task, meta?.next))}</dd></div>{sample && <div className="col-span-full"><dt>{t("样品依据")}</dt><dd>{t(getProcSampleFacts(task).label)}</dd></div>}</dl>
              <Button type="button" variant="outline" ref={(node) => { if (node) taskButtons.current.set(task.id, node); else taskButtons.current.delete(task.id); }} onClick={() => openDetail(task)} aria-label={t("查看任务完整详情：{code}", { code: task.code })} className="mt-3">{t("完整详情")}<ArrowUpRight className="size-3.5" /></Button>
            </li>;
          })}</ul>}
          {view.tasks.length > limit && <Button type="button" variant="outline" onClick={() => setLimit((current) => current + 20)}>{t("显示更多任务")} · {view.tasks.length - limit}</Button>}
        </>}
      </div>
      <div className="proc-person-tasks-footer"><Button type="button" variant="outline" onClick={onClose}><ArrowLeft className="size-4" />{t("返回人员列表")}</Button></div>
    </SheetContent>
  </Sheet>;
}
