// 采购人员管理独立页（对齐研发人员管理形态）：成员名录增删改（岗位备注）+
// 按负责人聚合任务负载 + 一键交接；非名录但有在制任务的人提示入录。
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Input } from "../components/ui/input";
import { Button } from "../components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "../components/ui/collapsible";
import { ScrollArea } from "../components/ui/scroll-area";
import { useNavigate } from "react-router";
import { AlertTriangle, ArrowLeft, ArrowRightLeft, CheckCircle2, ClipboardList, Gauge, Loader2, Pencil, Search, UserPlus, Users } from "lucide-react";
import { toast } from "sonner";
import { cn } from "../components/ui/utils";
import { usePermission } from "../hooks/usePermission";
import {
  autoAssignBuyerTasks,
  batchReassignProcTasks,
  getBuyerRoster,
  updateBuyerRosterMember,
  type BuyerRosterMember,
  type ProcurementTask,
} from "../lib/procurementApi";
import { daysFromToday, isProcurementTaskOverdue, refreshProcurement, useProcurementData } from "./data";
import { BuyerComboInput, PageHeader, PersonAvatar, PROC_STATUS_META, useBuyerDirectory } from "./components/common";
import { AutoTranslatedText } from "../components/TranslatableText";
import { useI18n } from "../lib/i18n";
import { PeopleManageDrawer } from "./components/PeopleManageDrawer";
import { resolveProcurementOwner, uniqueRosterUserIdsByName } from "./procurementLogic";
// 页面路径以「页面路由管理」的配置为准，随主路径变更自动跟随
import { routePath } from "../lib/routePaths";

const TERMINAL = ["completed", "cancelled"];
const TRANSIT = ["in_transit", "partial_arrival"];
const UNASSIGNED = "__unassigned__";

interface PersonRow {
  key: string;
  name: string;
  userId?: string;
  member: BuyerRosterMember | null;
  active: ProcurementTask[];
  pending: number;
  transit: number;
  overdue: number;
  week: number;
}

export function ProcPeopleManagementPage() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const { tasks } = useProcurementData();
  const { deptOf, resolveUserId } = useBuyerDirectory();
  const canManage = usePermission("proc-task:reassign");

  const [roster, setRoster] = useState<BuyerRosterMember[]>([]);
  const [rosterError, setRosterError] = useState("");
  const [manageOpen, setManageOpen] = useState(false);
  const [keyword, setKeyword] = useState("");
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [editingNote, setEditingNote] = useState<string | null>(null);
  const [noteDraft, setNoteDraft] = useState("");
  const [handover, setHandover] = useState<string | null>(null);
  const [target, setTarget] = useState("");
  const [actionError, setActionError] = useState<{ scope: string; message: string } | null>(null);

  const loadRoster = useCallback(async () => {
    setRosterError("");
    try {
      const result = await getBuyerRoster();
      setRoster(result.members);
    } catch (error) {
      setRosterError(error instanceof Error ? error.message : t("成员名录加载失败"));
    }
  }, [t]);

  useEffect(() => {
    void loadRoster();
  }, [loadRoster]);

  const allRows = useMemo<PersonRow[]>(() => {
    const memberById = new Map(roster.map((member) => [member.id, member]));
    const uniqueNameIds = uniqueRosterUserIdsByName(roster);
    const byBuyer = new Map<string, { name: string; userId?: string; tasks: ProcurementTask[] }>(
      roster.map((member) => [member.id, { name: member.name, userId: member.id, tasks: [] }]),
    );
    for (const task of tasks) {
      if (TERMINAL.includes(task.status)) continue;
      const { userId: ownerId, key } = resolveProcurementOwner(task, uniqueNameIds, UNASSIGNED);
      // 已移出名录但仍有在办任务的负责人继续展示，避免任务从负载与交接入口中消失。
      const current = byBuyer.get(key);
      if (current) {
        current.tasks.push(task);
      } else {
        byBuyer.set(key, {
          name: key === UNASSIGNED
            ? t("未指派")
            : memberById.get(ownerId ?? "")?.name ?? task.buyer ?? t("未知采购人员"),
          userId: ownerId,
          tasks: [task],
        });
      }
    }
    return Array.from(byBuyer.entries())
      .map(([key, person]) => {
        const member = memberById.get(key) ?? null;
        return ({
        key,
        name: person.name,
        userId: person.userId,
        member,
        active: person.tasks,
        pending: person.tasks.filter((x) => x.status === "pending_confirm").length,
        transit: person.tasks.filter((x) => TRANSIT.includes(x.status)).length,
        overdue: person.tasks.filter(isProcurementTaskOverdue).length,
        week: person.tasks.filter((x) => { const d = daysFromToday(x.expectedArrivalDate); return TRANSIT.includes(x.status) && d != null && d >= 0 && d <= 7; }).length,
      });})
      // 未指派置顶，其次名录成员，再按在制任务量降序
      .sort((a, b) =>
        Number(b.key === UNASSIGNED) - Number(a.key === UNASSIGNED) ||
        Number(Boolean(b.member)) - Number(Boolean(a.member)) ||
        b.active.length - a.active.length,
      );
  }, [tasks, roster, t]);

  const rows = useMemo(() => {
    const kw = keyword.trim().toLowerCase();
    if (!kw) return allRows;
    return allRows.filter((row) =>
      row.key === UNASSIGNED ||
      row.name.toLowerCase().includes(kw) ||
      (row.member?.note ?? "").toLowerCase().includes(kw),
    );
  }, [allRows, keyword]);

  const teamSummary = useMemo(() => ({
    active: allRows.reduce((sum, row) => sum + row.active.length, 0),
    pending: allRows.reduce((sum, row) => sum + row.pending, 0),
    overdue: allRows.reduce((sum, row) => sum + row.overdue, 0),
    unassigned: allRows.find((row) => row.key === UNASSIGNED)?.active.length ?? 0,
  }), [allRows]);

  const autoAssign = async () => {
    if (busyRef.current) return;
    busyRef.current = true;
    setActionError(null);
    setBusy(true);
    try {
      const result = await autoAssignBuyerTasks();
      await refreshProcurement();
      const distribution = result.distribution
        .map(({ name, count }) => `${name} ${count}`)
        .join("、");
      toast.success(
        result.assigned > 0
          ? t("已自动分派 {count} 个任务：{distribution}", { count: result.assigned, distribution })
          : t("当前没有待分派任务"),
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : t("自动分派失败");
      setActionError({ scope: "auto", message });
      toast.error(message);
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  const saveNote = async (member: BuyerRosterMember) => {
    if (busyRef.current) return;
    busyRef.current = true;
    setActionError(null);
    setBusy(true);
    try {
      const r = await updateBuyerRosterMember(member.id, noteDraft);
      setRoster(r.members);
      setEditingNote(null);
      toast.success(t("岗位备注已更新"));
    } catch (err) {
      const message = err instanceof Error ? err.message : t("更新失败");
      setActionError({ scope: `note:${member.id}`, message });
      toast.error(message);
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  const submitHandover = async (person: PersonRow) => {
    if (busyRef.current) return;
    if (person.active.length === 0) {
      const message = t("当前没有可交接的在办任务");
      setActionError({ scope: `handover:${person.key}`, message });
      toast.info(message);
      return;
    }
    const name = target.trim();
    if (!name) {
      const message = t("请填写接收人");
      setActionError({ scope: `handover:${person.key}`, message });
      toast.error(message);
      return;
    }
    const targetUserId = resolveUserId(name);
    if (person.key !== UNASSIGNED && ((person.userId && targetUserId === person.userId) || (!person.userId && name === person.name))) {
      const message = t("接收人不能是本人");
      setActionError({ scope: `handover:${person.key}`, message });
      toast.error(message);
      return;
    }
    busyRef.current = true;
    setActionError(null);
    setBusy(true);
    try {
      const result = await batchReassignProcTasks(person.active.map((x) => x.id), name, targetUserId);
      await refreshProcurement();
      toast.success(t("已把 {from} 的 {count} 个在制任务交接给 {to}", { from: person.name, count: result.updated, to: name }));
      setHandover(null);
      setTarget("");
    } catch (err) {
      const message = err instanceof Error ? err.message : t("交接失败");
      setActionError({ scope: `handover:${person.key}`, message });
      toast.error(message);
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  return (
    <div className="proc-horizon mx-auto flex h-full min-h-0 w-full max-w-[1200px] flex-col p-4">
      <PageHeader
        Icon={Users}
        badge={t("供应链管理")}
        title={t("供应链人员管理")}
        description={t("以采购成员名录展示任务负载，并保留仍有在办任务的非名录负责人；任务只能分配给具备采购个人工作台权限的成员。")}
        right={
          <div className="flex flex-wrap items-center gap-2">
            {canManage && (
              <button type="button" onClick={() => setManageOpen(true)} className="material-button-primary inline-flex items-center gap-1.5 px-3 py-2 text-sm">
                <UserPlus className="size-4" />{t("成员名录")}
              </button>
            )}
            <Button type="button" variant="outline" onClick={() => navigate(routePath("page:proc-cockpit", "/proc-cockpit"))} className="h-9 rounded-lg border-slate-200 px-3 text-sm text-slate-600">
              <ArrowLeft className="h-4 w-4" />{t("返回驾驶舱")}
            </Button>
          </div>
        }
      />

      <div className="mb-3 grid grid-cols-2 gap-2 lg:grid-cols-4">
        {[
          { icon: ClipboardList, label: t("团队在办"), value: teamSummary.active, detail: t("所有非终态采购任务") },
          { icon: Gauge, label: t("待处理"), value: teamSummary.pending, detail: t("需要负责人尽快确认"), risk: teamSummary.pending > 0 },
          { icon: AlertTriangle, label: t("已逾期"), value: teamSummary.overdue, detail: t("按需求或到货日期判断"), risk: teamSummary.overdue > 0 },
          { icon: UserPlus, label: t("未指派"), value: teamSummary.unassigned, detail: t("可使用智能分派处理"), risk: teamSummary.unassigned > 0 },
        ].map((item) => (
          <div key={item.label} className="proc-horizon-surface material-card flex min-w-0 items-center gap-3 px-3 py-2.5">
            <span className={cn("flex size-9 shrink-0 items-center justify-center rounded-xl", item.risk ? "bg-amber-50 text-amber-700" : "bg-[#eef3ff] text-[#002fa7]")}><item.icon className="size-4" /></span>
            <div className="min-w-0">
              <div className="flex items-baseline gap-2"><span className="truncate text-xs font-medium text-slate-500">{item.label}</span><strong className="shrink-0 text-lg tabular-nums text-slate-900">{item.value}</strong></div>
              <p className="truncate text-[11px] text-slate-400" title={item.detail}>{item.detail}</p>
            </div>
          </div>
        ))}
      </div>

      {/* 工具行：搜索 + 添加成员 */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <Input
            aria-label={t("搜索采购人员")}
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            placeholder={t("搜索姓名 / 岗位备注…")}
            className="h-9 w-64 rounded-lg border border-slate-200 bg-white pl-8 pr-3 text-sm outline-none focus:border-[#8fa9e8]"
          />
        </div>
        <span className="text-xs tabular-nums text-slate-400">{t("采购部门成员 {n} 人", { n: roster.length })}</span>
        {canManage && (
          <div className="ml-auto flex items-center gap-2">
            {tasks.some((task) => !TERMINAL.includes(task.status) && !task.buyer) && (
              <button
                type="button"
                disabled={busy}
                onClick={() => void autoAssign()}
                className="material-button-secondary inline-flex items-center gap-1.5 px-3 py-2 text-sm disabled:opacity-60"
              >
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowRightLeft className="h-4 w-4" />}
                {t("智能分派未分配任务")}
              </button>
            )}
          </div>
        )}
      </div>

      {rosterError && (
        <div role="alert" className="mb-3 flex items-center justify-between gap-3 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-600">
          <span className="min-w-0 text-pretty">{rosterError}</span>
          <button type="button" onClick={() => void loadRoster()} className="material-button-secondary shrink-0 px-3 py-2 text-xs">{t("重试")}</button>
        </div>
      )}
      {actionError?.scope === "auto" && (
        <div role="alert" className="mb-3 flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-pretty text-sm text-rose-700">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />{actionError.message}
        </div>
      )}

      {/* 成员/负载列表 */}
      <ScrollArea className="min-h-0 flex-1 pr-2">
      <div className="space-y-2 pb-4">
        {rows.length === 0 && (
          <div className="material-card flex flex-col items-center gap-3 py-12 text-center">
            <p className="text-pretty text-sm text-slate-500">{t("暂无采购成员与在制任务")}</p>
            {canManage && <button type="button" onClick={() => setManageOpen(true)} className="material-button-primary inline-flex items-center gap-1.5 px-3 py-2 text-xs"><UserPlus className="size-4" />{t("维护成员名录")}</button>}
          </div>
        )}
        {rows.map((p) => {
          const load = p.key === UNASSIGNED
            ? { label: t("待分配"), Icon: AlertTriangle, tone: "border-amber-200 bg-amber-50 text-amber-700" }
            : p.member?.canReceiveTasks === false
              ? { label: t("不可接单"), Icon: AlertTriangle, tone: "border-amber-200 bg-amber-50 text-amber-700" }
              : p.overdue > 0
                ? { label: t("需关注 · {count} 项逾期", { count: p.overdue }), Icon: AlertTriangle, tone: "border-rose-200 bg-rose-50 text-rose-700" }
                : p.active.length >= 8
                  ? { label: t("高负载 · {count} 项", { count: p.active.length }), Icon: Gauge, tone: "border-amber-200 bg-amber-50 text-amber-700" }
                  : { label: t("负载可用 · {count} 项", { count: p.active.length }), Icon: CheckCircle2, tone: "border-emerald-200 bg-emerald-50 text-emerald-700" };
          const previewTasks = [...p.active]
            .sort((a, b) => Number(isProcurementTaskOverdue(b)) - Number(isProcurementTaskOverdue(a)) || a.createdAt.localeCompare(b.createdAt))
            .slice(0, 3);
          return (
          <Collapsible key={p.key} open={handover === p.key && p.active.length > 0} onOpenChange={(open) => { if (open && p.active.length === 0) return; setHandover(open ? p.key : null); setTarget(""); setActionError(null); }} className={cn("proc-horizon-surface material-card p-4", p.key === UNASSIGNED && "proc-horizon-unassigned border-amber-200 bg-amber-50/40")}>
            <div className="flex items-center gap-2">
              <PersonAvatar name={p.key === UNASSIGNED ? "?" : p.name} size="xs" />
              <span className="max-w-36 truncate text-sm font-semibold text-slate-800" title={p.name}>{p.name}</span>
              {p.member ? (
                <span className={cn("inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[10px]", p.member.canReceiveTasks === false ? "border-amber-200 bg-amber-50 text-amber-700" : "border-[#cbd8f6] bg-[#eef3ff] text-[#002fa7]")}>
                  {p.member.canReceiveTasks === false && <AlertTriangle className="h-3 w-3" />}
                  {t(p.member.canReceiveTasks === false ? "缺少采购工作台权限" : "采购部门成员")}
                </span>
              ) : p.key !== UNASSIGNED ? (
                <span className="rounded-full border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-[10px] text-slate-400">{t("未入名录")}</span>
              ) : null}
              {p.key !== UNASSIGNED && deptOf(p.name) && <AutoTranslatedText as="span" className="text-[11px] text-slate-400" text={deptOf(p.name)!} />}
              {p.member?.note && editingNote !== p.member.id && (
                <span className="max-w-44 truncate rounded bg-slate-50 px-1.5 py-0.5 text-[11px] text-slate-500" title={p.member.note}><AutoTranslatedText text={p.member.note} /></span>
              )}
              <div className="ml-auto flex items-center gap-1.5">
                <span className={cn("inline-flex items-center gap-1 rounded-full border px-2 py-1 text-[10px] font-medium tabular-nums", load.tone)}><load.Icon className="size-3" />{load.label}</span>
                {canManage && p.member && (
                  <button type="button" aria-label={t("编辑岗位备注")} onClick={() => { setEditingNote((cur) => (cur === p.member!.id ? null : p.member!.id)); setNoteDraft(p.member.note ?? ""); }} className="flex size-8 items-center justify-center rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50" title={t("编辑岗位备注")}>
                    <Pencil className="h-3.5 w-3.5" />
                  </button>
                )}
                {canManage && (
                  <CollapsibleTrigger asChild>
                  <Button type="button" variant="outline" size="sm" disabled={p.active.length === 0} className="h-7 rounded-lg border-slate-200 px-2.5 text-xs text-slate-600">
                    <ArrowRightLeft className="h-3.5 w-3.5" />{t(p.key === UNASSIGNED ? "指派" : "交接")}
                  </Button>
                  </CollapsibleTrigger>
                )}
              </div>
            </div>

            {canManage && p.member && editingNote === p.member.id && (
              <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50/60 p-3">
                <div className="flex items-center gap-2">
                <Input
                  autoFocus
                  disabled={busy}
                  value={noteDraft}
                  onChange={(e) => { setNoteDraft(e.target.value); setActionError(null); }}
                  onKeyDown={(e) => { if (e.key === "Enter") void saveNote(p.member!); if (e.key === "Escape") setEditingNote(null); }}
                  placeholder={t("岗位备注，如「电子料询价」「包材/耗材」")}
                  className="h-8 flex-1 rounded-lg border border-[#cbd8f6] px-2 text-sm outline-none focus:border-[#8fa9e8]"
                />
                <button type="button" disabled={busy} onClick={() => void saveNote(p.member!)} className="rounded-lg bg-[#002fa7] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#001f73] disabled:opacity-60">{busy ? t("正在保存…") : t("保存岗位备注")}</button>
                </div>
                {actionError?.scope === `note:${p.member.id}` && <p role="alert" className="mt-2 text-pretty text-xs text-rose-700">{actionError.message}</p>}
              </div>
            )}

            <div className="mt-2 grid grid-cols-5 gap-1 rounded-lg bg-slate-50/70 py-1.5 text-center">
              {([
                [p.active.length, "在制"],
                [p.pending, "待处理"],
                [p.transit, "在途"],
                [p.overdue, "逾期"],
                [p.week, "本周到货"],
              ] as const).map(([n, label]) => (
                <div key={label}>
                  <div className={cn("text-base font-bold tabular-nums", (label === "逾期" || label === "待处理") && n > 0 ? "text-rose-600" : "text-slate-900")}>{n}</div>
                  <div className="text-[10px] text-slate-400">{t(label)}</div>
                </div>
              ))}
            </div>

            <div className="mt-3 border-t border-slate-100 pt-3">
              <div className="mb-2 flex items-center justify-between gap-3">
                <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-600"><ClipboardList className="size-3.5" />{t("在办任务")}</span>
                {p.active.length > previewTasks.length && <span className="text-[11px] tabular-nums text-slate-400">{t("另有 {count} 项", { count: p.active.length - previewTasks.length })}</span>}
              </div>
              {previewTasks.length > 0 ? (
                <div className="space-y-1.5">
                  {previewTasks.map((task) => {
                    const overdue = isProcurementTaskOverdue(task);
                    const date = task.expectedArrivalDate || task.needDate || task.deadline;
                    const status = PROC_STATUS_META[task.status];
                    return (
                      <div key={task.id} className="grid grid-cols-[auto_minmax(0,1fr)_auto_auto] items-center gap-2 rounded-lg border border-slate-100 bg-slate-50/60 px-2.5 py-2 text-xs">
                        <span className="font-mono tabular-nums text-slate-400">{task.code}</span>
                        <span className="truncate font-medium text-slate-700" title={task.materialName}><AutoTranslatedText text={task.materialName} /></span>
                        <span className={cn("rounded-full border px-1.5 py-0.5 text-[10px]", status?.pill)}>{t(status?.label ?? task.status)}</span>
                        <span className={cn("whitespace-nowrap tabular-nums", overdue ? "font-medium text-rose-700" : "text-slate-400")}>{overdue ? t("已逾期") : date || t("日期待定")}</span>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <p className="text-pretty text-xs text-slate-400">{t("当前没有在办任务，可继续接收分派。")}</p>
              )}
            </div>

            <CollapsibleContent>
              <div className="mt-3 rounded-lg border border-[#dce6ff] bg-[#eef3ff]/60 p-3">
                <p className="mb-2 text-pretty text-xs text-slate-600">{t(p.key === UNASSIGNED ? "将该组全部未指派任务一次分配给指定负责人。" : "将该负责人名下全部在办任务一次性交接，历史记录保持不变。")}</p>
                <div className="flex items-center gap-2">
                <BuyerComboInput
                  autoFocus
                  disabled={busy}
                  ariaLabel={t("任务接收人")}
                  value={target}
                  onChange={(value) => { setTarget(value); setActionError(null); }}
                  onEnter={() => void submitHandover(p)}
                  onEscape={() => setHandover(null)}
                  placeholder={t("接收人姓名")}
                  className="h-8 flex-1 rounded-lg border border-[#cbd8f6] px-2 text-sm outline-none focus:border-[#8fa9e8]"
                />
                <button type="button" disabled={busy || p.active.length === 0} onClick={() => void submitHandover(p)} className="inline-flex items-center gap-1 rounded-lg bg-[#002fa7] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#001f73] disabled:opacity-60">
                  {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                  {busy ? t("正在提交…") : t(p.key === UNASSIGNED ? "指派 {count} 个任务" : "交接 {count} 个任务", { count: p.active.length })}
                </button>
                </div>
                {actionError?.scope === `handover:${p.key}` && <p role="alert" className="mt-2 text-pretty text-xs text-rose-700">{actionError.message}</p>}
              </div>
            </CollapsibleContent>
          </Collapsible>
          );
        })}
      </div>
      </ScrollArea>
      {manageOpen && <PeopleManageDrawer onClose={() => { setManageOpen(false); void loadRoster(); }} />}
    </div>
  );
}
