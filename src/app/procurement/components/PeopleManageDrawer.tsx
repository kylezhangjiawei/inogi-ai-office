// 采购人员管理抽屉：成员名录维护（对齐研发模式）+ 按负责人聚合任务负载
// （进行中/待处理/在途逾期/本周到货），支持一键把某人全部在制任务交接给另一人。
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, ArrowRightLeft, CheckCircle2, ClipboardList, Gauge, Loader2, UserPlus } from "lucide-react";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "../../components/ui/sheet";
import { toast } from "sonner";
import { cn } from "../../components/ui/utils";
import { usePermission } from "../../hooks/usePermission";
import {
  addBuyerRosterMember,
  batchReassignProcTasks,
  getBuyerRoster,
  removeBuyerRosterMember,
  type BuyerRosterMember,
  type ProcurementTask,
} from "../../lib/procurementApi";
import { daysFromToday, isProcurementTaskOverdue, refreshProcurement, useProcurementData } from "../data";
import { BuyerComboInput, PersonAvatar, PROC_STATUS_META, useBuyerDirectory, useConfirmDialog } from "./common";
import { AutoTranslatedText } from "../../components/TranslatableText";
import { useI18n } from "../../lib/i18n";
import { resolveProcurementOwner, uniqueRosterUserIdsByName } from "../procurementLogic";

const TERMINAL = ["completed", "cancelled"];
const TRANSIT = ["in_transit", "partial_arrival"];
const UNASSIGNED = "__unassigned__";

interface PersonLoad {
  key: string;
  name: string;
  userId?: string;
  active: ProcurementTask[];
  pending: number;
  transit: number;
  overdue: number;
  week: number;
}

export function PeopleManageDrawer({ onClose, onFocusPerson }: {
  onClose: () => void;
  /** 点击人名把驾驶舱人员泳道聚焦到该人（并关闭抽屉）。 */
  onFocusPerson?: (name: string) => void;
}) {
  const { t } = useI18n();
  const { tasks } = useProcurementData();
  const { deptOf, resolveUserId } = useBuyerDirectory();
  const canReassign = usePermission("proc-task:reassign");
  const [handover, setHandover] = useState<string | null>(null);
  const [target, setTarget] = useState("");
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [roster, setRoster] = useState<BuyerRosterMember[]>([]);
  const [addName, setAddName] = useState("");
  const [rosterBusy, setRosterBusy] = useState(false);
  const rosterBusyRef = useRef(false);
  const [rosterLoading, setRosterLoading] = useState(true);
  const [rosterError, setRosterError] = useState("");
  const [actionError, setActionError] = useState<{ scope: string; message: string } | null>(null);
  const { confirm: confirmAction, confirmDialog } = useConfirmDialog();

  const loadRoster = useCallback(async () => {
    setRosterLoading(true);
    setRosterError("");
    try {
      const result = await getBuyerRoster();
      setRoster(result.members);
    } catch (error) {
      setRosterError(error instanceof Error ? error.message : t("成员名录加载失败"));
    } finally {
      setRosterLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void loadRoster();
  }, [loadRoster]);

  const addMember = async () => {
    if (rosterBusyRef.current) return;
    const name = addName.trim();
    if (!name) return;
    const userId = resolveUserId(name);
    if (!userId) {
      const message = t("找不到该用户（或存在同名，请确认姓名）");
      setActionError({ scope: "roster", message });
      toast.error(message);
      return;
    }
    if (roster.some((m) => m.id === userId)) {
      const message = t("该成员已在名录中");
      setActionError({ scope: "roster", message });
      toast.error(message);
      return;
    }
    rosterBusyRef.current = true;
    setActionError(null);
    setRosterBusy(true);
    try {
      const r = await addBuyerRosterMember(userId);
      setRoster(r.members);
      setAddName("");
      toast.success(t("已加入采购成员名录：{name}", { name }));
    } catch (err) {
      const message = err instanceof Error ? err.message : t("添加失败");
      setActionError({ scope: "roster", message });
      toast.error(message);
    } finally {
      rosterBusyRef.current = false;
      setRosterBusy(false);
    }
  };

  const removeMember = async (member: BuyerRosterMember) => {
    if (rosterBusyRef.current) return;
    rosterBusyRef.current = true;
    setActionError(null);
    setRosterBusy(true);
    try {
      const r = await removeBuyerRosterMember(member.id);
      setRoster(r.members);
      toast.success(t("已从名录移除：{name}（历史任务不受影响）", { name: member.name }));
    } catch (err) {
      const message = err instanceof Error ? err.message : t("移除失败");
      setActionError({ scope: "roster", message });
      toast.error(message);
      throw err instanceof Error ? err : new Error(message);
    } finally {
      rosterBusyRef.current = false;
      setRosterBusy(false);
    }
  };

  const requestRemoveMember = (member: BuyerRosterMember) => confirmAction({
    title: t("移出采购成员名录"),
    desc: t("确定将「{name}」移出成员名录吗？历史任务和当前任务负责人不会改变，之后仍可重新加入。", { name: member.name }),
    tone: "danger",
    actionLabel: t("移出名录"),
    onConfirm: () => removeMember(member),
  });

  const people = useMemo<PersonLoad[]>(() => {
    const memberById = new Map(roster.map((member) => [member.id, member]));
    const uniqueNameIds = uniqueRosterUserIdsByName(roster);

    const byBuyer = new Map<string, { name: string; userId?: string; tasks: ProcurementTask[] }>();
    for (const member of roster) {
      byBuyer.set(`user:${member.id}`, { name: member.name, userId: member.id, tasks: [] });
    }
    for (const task of tasks) {
      if (TERMINAL.includes(task.status)) continue;
      const { userId: matchedRosterId, key } = resolveProcurementOwner(
        task,
        uniqueNameIds,
        UNASSIGNED,
        (userId) => `user:${userId}`,
      );
      const current = byBuyer.get(key);
      if (current) {
        current.tasks.push(task);
      } else {
        byBuyer.set(key, {
          name: key === UNASSIGNED
            ? t("未指派")
            : memberById.get(matchedRosterId ?? "")?.name ?? task.buyer ?? t("未知采购人员"),
          userId: matchedRosterId,
          tasks: [task],
        });
      }
    }

    const rows = Array.from(byBuyer.entries()).map(([key, person]) => ({
      key,
      name: person.name,
      userId: person.userId,
      active: person.tasks,
      pending: person.tasks.filter((x) => x.status === "pending_confirm").length,
      transit: person.tasks.filter((x) => TRANSIT.includes(x.status)).length,
      overdue: person.tasks.filter(isProcurementTaskOverdue).length,
      week: person.tasks.filter((x) => { const d = daysFromToday(x.expectedArrivalDate); return TRANSIT.includes(x.status) && d != null && d >= 0 && d <= 7; }).length,
    }));
    // 未指派置顶提醒处理，其余按在制任务量降序
    return rows.sort((a, b) => Number(b.key === UNASSIGNED) - Number(a.key === UNASSIGNED) || b.active.length - a.active.length);
  }, [tasks, roster, t]);

  const submitHandover = async (person: PersonLoad) => {
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
    <Sheet open onOpenChange={(o) => { if (!o && !busy && !rosterBusy) onClose(); }}>
      <SheetContent side="right" className="proc-horizon-drawer w-full max-w-full gap-0 p-0 pb-[env(safe-area-inset-bottom)] sm:w-[620px] sm:max-w-[620px]">
        <SheetHeader className="border-b border-slate-100 px-6 py-4">
          <SheetTitle className="text-balance text-base font-bold tabular-nums text-slate-900">{t("人员管理（{count} 人在制）", { count: people.filter((p) => p.key !== UNASSIGNED && p.active.length > 0).length })}</SheetTitle>
          <SheetDescription className="mt-0.5 text-pretty text-xs text-slate-400">{t("按采购负责人查看任务负载；离职/休假时可一键把在制任务整体交接。")}</SheetDescription>
        </SheetHeader>

        <div className="min-h-0 flex-1 space-y-2 overflow-y-auto px-6 py-4">
          {/* 成员名录：显式圈定采购组成员（分配任务候选优先显示名录成员；移除不影响历史任务） */}
          <div className="mb-3 rounded-xl border border-slate-100 bg-slate-50/50 p-3">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-xs font-semibold tabular-nums text-slate-600">{t("成员名录（{n} 人）", { n: roster.length })}</span>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {rosterLoading ? <span className="inline-flex items-center gap-1 text-[11px] text-slate-400"><Loader2 className="size-3 animate-spin" />{t("正在加载成员名录…")}</span> : roster.map((m) => (
                <span key={m.id} className={cn("inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px]", m.disabled ? "border-slate-200 bg-slate-100 text-slate-400 line-through" : "border-[#cbd8f6] bg-[#eef3ff] text-[#002fa7]")}>
                  {m.name}{m.department ? <AutoTranslatedText as="span" className="text-[10px] opacity-60" text={m.department} /> : null}
                  {canReassign && (
                    <button type="button" aria-label={t("从名录移除：{name}", { name: m.name })} disabled={rosterBusy} onClick={() => requestRemoveMember(m)} className="ml-0.5 flex size-6 items-center justify-center rounded-full text-slate-400 hover:bg-rose-50 hover:text-rose-500" title={t("从名录移除")}>×</button>
                  )}
                </span>
              ))}
              {!rosterLoading && roster.length === 0 && <span className="text-[11px] text-slate-400">{t("尚未添加成员；未添加时任务可分配给任何用户")}</span>}
            </div>
            {rosterError && <div role="alert" className="mt-2 flex items-center justify-between gap-2 rounded-lg border border-rose-200 bg-rose-50 px-2.5 py-2 text-pretty text-xs text-rose-700"><span>{rosterError}</span><button type="button" onClick={() => void loadRoster()} className="shrink-0 font-semibold underline">{t("重试")}</button></div>}
            {canReassign && (
              <div className="mt-2 flex items-center gap-2">
                <BuyerComboInput
                  disabled={rosterBusy}
                  ariaLabel={t("新增采购成员")}
                  value={addName}
                  onChange={(value) => { setAddName(value); setActionError(null); }}
                  onEnter={() => void addMember()}
                  placeholder={t("输入姓名添加成员…")}
                  className="h-8 flex-1 rounded-lg border border-slate-200 bg-white px-2 text-sm outline-none focus:border-[#8fa9e8]"
                />
                <button type="button" disabled={rosterBusy || !addName.trim()} onClick={() => void addMember()} className="inline-flex items-center gap-1 rounded-lg bg-[#002fa7] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#001f73] disabled:opacity-60">
                  {rosterBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <UserPlus className="h-3.5 w-3.5" />}{t("添加")}
                </button>
              </div>
            )}
            {actionError?.scope === "roster" && <p role="alert" className="mt-2 text-pretty text-xs text-rose-700">{actionError.message}</p>}
          </div>

          {people.length === 0 && <div className="py-10 text-center text-sm text-slate-400">{t("当前没有在制任务")}</div>}
          {people.map((p) => {
            const load = p.key === UNASSIGNED
              ? { label: t("待分配"), Icon: AlertTriangle, tone: "border-amber-200 bg-amber-50 text-amber-700" }
              : p.overdue > 0
                ? { label: t("需关注 · {count} 项逾期", { count: p.overdue }), Icon: AlertTriangle, tone: "border-rose-200 bg-rose-50 text-rose-700" }
                : p.active.length >= 8
                  ? { label: t("高负载 · {count} 项", { count: p.active.length }), Icon: Gauge, tone: "border-amber-200 bg-amber-50 text-amber-700" }
                  : { label: t("负载可用 · {count} 项", { count: p.active.length }), Icon: CheckCircle2, tone: "border-emerald-200 bg-emerald-50 text-emerald-700" };
            const previewTasks = [...p.active]
              .sort((a, b) => Number(isProcurementTaskOverdue(b)) - Number(isProcurementTaskOverdue(a)) || a.createdAt.localeCompare(b.createdAt))
              .slice(0, 2);
            return (
            <div key={p.key} className={cn("rounded-xl border p-3", p.key === UNASSIGNED ? "border-amber-200 bg-amber-50/40" : "border-slate-100")}>
              <div className="flex items-center gap-2">
                <PersonAvatar name={p.key === UNASSIGNED ? "?" : p.name} size="xs" />
                {p.key !== UNASSIGNED && onFocusPerson ? (
                  <button
                    type="button"
                    onClick={() => { onFocusPerson(p.name); onClose(); }}
                    className="max-w-36 truncate text-sm font-semibold text-slate-800 hover:text-[#002fa7] hover:underline"
                    title={t("在驾驶舱中筛选该负责人的任务")}
                  >
                    {p.name}
                  </button>
                ) : (
                  <span className="max-w-36 truncate text-sm font-semibold text-slate-800" title={p.name}>{p.name}</span>
                )}
                {p.key !== UNASSIGNED && deptOf(p.name) && <AutoTranslatedText as="span" className="text-[11px] text-slate-400" text={deptOf(p.name)!} />}
                <span className={cn("ml-auto inline-flex items-center gap-1 rounded-full border px-2 py-1 text-[10px] font-medium tabular-nums", load.tone)}><load.Icon className="size-3" />{load.label}</span>
                {canReassign && p.active.length > 0 && (
                  <button
                    type="button"
                    onClick={() => { setHandover((cur) => (cur === p.key ? null : p.key)); setTarget(""); setActionError(null); }}
                    className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50"
                  >
                    <ArrowRightLeft className="h-3.5 w-3.5" />{t(p.key === UNASSIGNED ? "指派" : "交接")}
                  </button>
                )}
              </div>
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
              <div className="mt-2 border-t border-slate-100 pt-2">
                <div className="mb-1.5 flex items-center justify-between gap-2"><span className="inline-flex items-center gap-1 text-[11px] font-semibold text-slate-500"><ClipboardList className="size-3" />{t("在办任务")}</span>{p.active.length > previewTasks.length && <span className="text-[10px] tabular-nums text-slate-400">{t("另 {count} 项", { count: p.active.length - previewTasks.length })}</span>}</div>
                {previewTasks.length > 0 ? <div className="space-y-1">{previewTasks.map((task) => {
                  const overdue = isProcurementTaskOverdue(task);
                  const status = PROC_STATUS_META[task.status];
                  return <div key={task.id} className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2 rounded-lg bg-slate-50 px-2 py-1.5 text-[11px]"><span className="font-mono tabular-nums text-slate-400">{task.code}</span><span className="truncate text-slate-700" title={task.materialName}><AutoTranslatedText text={task.materialName} /></span><span className={cn("rounded-full border px-1.5 py-0.5 text-[10px]", status?.pill, overdue && "font-semibold")}>{overdue ? t("已逾期") : t(status?.label ?? task.status)}</span></div>;
                })}</div> : <p className="text-pretty text-[11px] text-slate-400">{t("暂无在办任务，可继续接收分派。")}</p>}
              </div>
              {handover === p.key && (
                <div className="mt-2 rounded-lg border border-[#dce6ff] bg-[#eef3ff]/60 p-2.5">
                  <p className="mb-2 text-pretty text-[11px] text-slate-600">{t(p.key === UNASSIGNED ? "把本组全部未指派任务一次分配给指定负责人。" : "把该负责人名下全部在办任务一次性交接，历史记录不受影响。")}</p>
                  <div className="flex items-center gap-2">
                  <BuyerComboInput
                    autoFocus
                    disabled={busy}
                    ariaLabel={t(p.key === UNASSIGNED ? "任务接收人" : "交接接收人")}
                    value={target}
                    onChange={(value) => { setTarget(value); setActionError(null); }}
                    onEnter={() => void submitHandover(p)}
                    onEscape={() => setHandover(null)}
                    placeholder={t("接收人姓名")}
                    className="h-8 flex-1 rounded-lg border border-[#cbd8f6] px-2 text-sm outline-none focus:border-[#8fa9e8]"
                  />
                  <button type="button" disabled={busy} onClick={() => void submitHandover(p)} className="inline-flex items-center gap-1 rounded-lg bg-[#002fa7] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#001f73] disabled:opacity-60">
                    {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                    {busy ? t("正在提交…") : t(p.key === UNASSIGNED ? "指派 {count} 个任务" : "交接 {count} 个任务", { count: p.active.length })}
                  </button>
                  </div>
                  {actionError?.scope === `handover:${p.key}` && <p role="alert" className="mt-2 text-pretty text-xs text-rose-700">{actionError.message}</p>}
                </div>
              )}
            </div>
            );
          })}
        </div>
        {confirmDialog}
      </SheetContent>
    </Sheet>
  );
}
