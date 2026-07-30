// 采购人员管理抽屉：成员名录维护（对齐研发模式）+ 按负责人聚合任务负载
// （进行中/待处理/在途逾期/本周到货），支持一键把某人全部在制任务交接给另一人。
import { useEffect, useMemo, useState } from "react";
import { Input } from "../../components/ui/input";
import { ArrowRightLeft, Loader2, UserPlus } from "lucide-react";
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
import { BuyerComboInput, PersonAvatar, useBuyerDirectory } from "./common";
import { AutoTranslatedText } from "../../components/TranslatableText";
import { useI18n } from "../../lib/i18n";

const TERMINAL = ["completed", "cancelled"];
const TRANSIT = ["in_transit", "partial_arrival"];
const UNASSIGNED = "__unassigned__";

interface PersonLoad {
  key: string;
  name: string;
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
  const [roster, setRoster] = useState<BuyerRosterMember[]>([]);
  const [addName, setAddName] = useState("");
  const [rosterBusy, setRosterBusy] = useState(false);

  useEffect(() => {
    void getBuyerRoster().then((r) => setRoster(r.members)).catch(() => {});
  }, []);

  const addMember = async () => {
    const name = addName.trim();
    if (!name) return;
    const userId = resolveUserId(name);
    if (!userId) { toast.error(t("找不到该用户（或存在同名，请确认姓名）")); return; }
    if (roster.some((m) => m.id === userId)) { toast.error(t("该成员已在名录中")); return; }
    setRosterBusy(true);
    try {
      const r = await addBuyerRosterMember(userId);
      setRoster(r.members);
      setAddName("");
      toast.success(t("已加入采购成员名录：{name}", { name }));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("添加失败"));
    } finally {
      setRosterBusy(false);
    }
  };

  const removeMember = async (member: BuyerRosterMember) => {
    setRosterBusy(true);
    try {
      const r = await removeBuyerRosterMember(member.id);
      setRoster(r.members);
      toast.success(t("已从名录移除：{name}（历史任务不受影响）", { name: member.name }));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("移除失败"));
    } finally {
      setRosterBusy(false);
    }
  };

  const people = useMemo<PersonLoad[]>(() => {
    const byBuyer = new Map<string, ProcurementTask[]>();
    for (const task of tasks) {
      if (TERMINAL.includes(task.status)) continue;
      const key = task.buyer || UNASSIGNED;
      const list = byBuyer.get(key);
      if (list) list.push(task); else byBuyer.set(key, [task]);
    }
    // 名录成员即使当前零任务也显示（新成员/闲置成员可见，便于分配）
    for (const m of roster) {
      if (!byBuyer.has(m.name)) byBuyer.set(m.name, []);
    }
    const rows = Array.from(byBuyer.entries()).map(([key, active]) => ({
      key,
      name: key === UNASSIGNED ? t("未指派") : key,
      active,
      pending: active.filter((x) => x.status === "pending_confirm").length,
      transit: active.filter((x) => TRANSIT.includes(x.status)).length,
      overdue: active.filter(isProcurementTaskOverdue).length,
      week: active.filter((x) => { const d = daysFromToday(x.expectedArrivalDate); return TRANSIT.includes(x.status) && d != null && d >= 0 && d <= 7; }).length,
    }));
    // 未指派置顶提醒处理，其余按在制任务量降序
    return rows.sort((a, b) => Number(b.key === UNASSIGNED) - Number(a.key === UNASSIGNED) || b.active.length - a.active.length);
  }, [tasks, roster, t]);

  const submitHandover = async (person: PersonLoad) => {
    const name = target.trim();
    if (!name) { toast.error(t("请填写接收人")); return; }
    if (person.key !== UNASSIGNED && name === person.key) { toast.error(t("接收人不能是本人")); return; }
    setBusy(true);
    try {
      const result = await batchReassignProcTasks(person.active.map((x) => x.id), name, resolveUserId(name));
      await refreshProcurement();
      toast.success(t("已把 {from} 的 {count} 个在制任务交接给 {to}", { from: person.name, count: result.updated, to: name }));
      setHandover(null);
      setTarget("");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("交接失败"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet open onOpenChange={(o) => { if (!o) onClose(); }}>
      <SheetContent side="right" className="w-[620px] gap-0 p-0 sm:max-w-[620px]">
        <SheetHeader className="border-b border-slate-100 px-6 py-4">
          <SheetTitle className="text-base font-bold text-slate-900">{t("人员管理（{count} 人在制）", { count: people.filter((p) => p.key !== UNASSIGNED).length })}</SheetTitle>
          <SheetDescription className="mt-0.5 text-xs text-slate-400">{t("按采购负责人查看任务负载；离职/休假时可一键把在制任务整体交接。")}</SheetDescription>
        </SheetHeader>

        <div className="min-h-0 flex-1 space-y-2 overflow-y-auto px-6 py-4">
          {/* 成员名录：显式圈定采购组成员（分配任务候选优先显示名录成员；移除不影响历史任务） */}
          <div className="mb-3 rounded-xl border border-slate-100 bg-slate-50/50 p-3">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-xs font-semibold text-slate-600">{t("成员名录（{n} 人）", { n: roster.length })}</span>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {roster.map((m) => (
                <span key={m.id} className={cn("inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px]", m.disabled ? "border-slate-200 bg-slate-100 text-slate-400 line-through" : "border-indigo-200 bg-indigo-50 text-indigo-700")}>
                  {m.name}{m.department ? <AutoTranslatedText as="span" className="text-[10px] opacity-60" text={m.department} /> : null}
                  {canReassign && (
                    <button type="button" disabled={rosterBusy} onClick={() => void removeMember(m)} className="ml-0.5 text-slate-400 hover:text-rose-500" title={t("从名录移除")}>×</button>
                  )}
                </span>
              ))}
              {roster.length === 0 && <span className="text-[11px] text-slate-400">{t("尚未添加成员；未添加时任务可分配给任何用户")}</span>}
            </div>
            {canReassign && (
              <div className="mt-2 flex items-center gap-2">
                <BuyerComboInput
                  value={addName}
                  onChange={setAddName}
                  onEnter={() => void addMember()}
                  placeholder={t("输入姓名添加成员…")}
                  className="h-8 flex-1 rounded-lg border border-slate-200 bg-white px-2 text-sm outline-none focus:border-indigo-300"
                />
                <button type="button" disabled={rosterBusy || !addName.trim()} onClick={() => void addMember()} className="inline-flex items-center gap-1 rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-indigo-700 disabled:opacity-60">
                  {rosterBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <UserPlus className="h-3.5 w-3.5" />}{t("添加")}
                </button>
              </div>
            )}
          </div>

          {people.length === 0 && <div className="py-10 text-center text-sm text-slate-400">{t("当前没有在制任务")}</div>}
          {people.map((p) => (
            <div key={p.key} className={cn("rounded-xl border p-3", p.key === UNASSIGNED ? "border-amber-200 bg-amber-50/40" : "border-slate-100")}>
              <div className="flex items-center gap-2">
                <PersonAvatar name={p.key === UNASSIGNED ? "?" : p.name} size="xs" />
                <button
                  type="button"
                  onClick={() => { if (p.key !== UNASSIGNED && onFocusPerson) { onFocusPerson(p.key); onClose(); } }}
                  className={cn("text-sm font-semibold text-slate-800", p.key !== UNASSIGNED && onFocusPerson && "hover:text-indigo-600 hover:underline")}
                  title={p.key !== UNASSIGNED ? t("在驾驶舱中筛选该负责人的任务") : undefined}
                >
                  {p.name}
                </button>
                {p.key !== UNASSIGNED && deptOf(p.key) && <AutoTranslatedText as="span" className="text-[11px] text-slate-400" text={deptOf(p.key)!} />}
                {canReassign && (
                  <button
                    type="button"
                    onClick={() => { setHandover((cur) => (cur === p.key ? null : p.key)); setTarget(""); }}
                    className="ml-auto inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50"
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
                    <div className={cn("text-base font-bold tabular-nums", label === "逾期" && n > 0 ? "text-red-600" : label === "待处理" && n > 0 ? "text-rose-600" : "text-slate-900")}>{n}</div>
                    <div className="text-[10px] text-slate-400">{t(label)}</div>
                  </div>
                ))}
              </div>
              {handover === p.key && (
                <div className="mt-2 flex items-center gap-2">
                  <BuyerComboInput
                    autoFocus
                    value={target}
                    onChange={setTarget}
                    onEnter={() => void submitHandover(p)}
                    onEscape={() => setHandover(null)}
                    placeholder={t("接收人姓名")}
                    className="h-8 flex-1 rounded-lg border border-indigo-200 px-2 text-sm outline-none focus:border-indigo-400"
                  />
                  <button type="button" disabled={busy} onClick={() => void submitHandover(p)} className="inline-flex items-center gap-1 rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-indigo-700 disabled:opacity-60">
                    {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                    {t(p.key === UNASSIGNED ? "指派 {count} 个任务" : "交接 {count} 个任务", { count: p.active.length })}
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      </SheetContent>
    </Sheet>
  );
}
