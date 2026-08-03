// 采购人员管理独立页（对齐研发人员管理形态）：成员名录增删改（岗位备注）+
// 按负责人聚合任务负载 + 一键交接；非名录但有在制任务的人提示入录。
import { useEffect, useMemo, useState } from "react";
import { Input } from "../components/ui/input";
import { useNavigate } from "react-router";
import { ArrowLeft, ArrowRightLeft, Loader2, Pencil, Search, Trash2, UserPlus, Users } from "lucide-react";
import { toast } from "sonner";
import { cn } from "../components/ui/utils";
import { usePermission } from "../hooks/usePermission";
import {
  addBuyerRosterMember,
  autoAssignBuyerTasks,
  batchReassignProcTasks,
  getBuyerRoster,
  removeBuyerRosterMember,
  updateBuyerRosterMember,
  type BuyerRosterMember,
  type ProcurementTask,
} from "../lib/procurementApi";
import { daysFromToday, isProcurementTaskOverdue, refreshProcurement, useProcurementData } from "./data";
import { BuyerComboInput, PageHeader, PersonAvatar, useBuyerDirectory, useConfirmDialog } from "./components/common";
import { AutoTranslatedText } from "../components/TranslatableText";
import { useI18n } from "../lib/i18n";
// 页面路径以「页面路由管理」的配置为准，随主路径变更自动跟随
import { routePath } from "../lib/routePaths";

const TERMINAL = ["completed", "cancelled"];
const TRANSIT = ["in_transit", "partial_arrival"];
const UNASSIGNED = "__unassigned__";

interface PersonRow {
  key: string;
  name: string;
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
  const { resolveUserId: resolveAnyUserId } = useBuyerDirectory({ includeAll: true });
  const canManage = usePermission("proc-task:reassign");
  const { confirm: confirmAction, confirmDialog } = useConfirmDialog();

  const [roster, setRoster] = useState<BuyerRosterMember[]>([]);
  const [keyword, setKeyword] = useState("");
  const [addName, setAddName] = useState("");
  const [busy, setBusy] = useState(false);
  const [editingNote, setEditingNote] = useState<string | null>(null);
  const [noteDraft, setNoteDraft] = useState("");
  const [handover, setHandover] = useState<string | null>(null);
  const [target, setTarget] = useState("");

  useEffect(() => {
    void getBuyerRoster().then((r) => setRoster(r.members)).catch(() => {});
  }, []);

  const rows = useMemo<PersonRow[]>(() => {
    const byBuyer = new Map<string, ProcurementTask[]>();
    for (const task of tasks) {
      if (TERMINAL.includes(task.status)) continue;
      const key = task.buyer || UNASSIGNED;
      const list = byBuyer.get(key);
      if (list) list.push(task); else byBuyer.set(key, [task]);
    }
    const memberByName = new Map(roster.map((m) => [m.name, m]));
    for (const m of roster) if (!byBuyer.has(m.name)) byBuyer.set(m.name, []);
    const kw = keyword.trim().toLowerCase();
    return Array.from(byBuyer.entries())
      .map(([key, active]) => ({
        key,
        name: key === UNASSIGNED ? t("未指派") : key,
        member: memberByName.get(key) ?? null,
        active,
        pending: active.filter((x) => x.status === "pending_confirm").length,
        transit: active.filter((x) => TRANSIT.includes(x.status)).length,
        overdue: active.filter(isProcurementTaskOverdue).length,
        week: active.filter((x) => { const d = daysFromToday(x.expectedArrivalDate); return TRANSIT.includes(x.status) && d != null && d >= 0 && d <= 7; }).length,
      }))
      .filter((r) => !kw || r.key === UNASSIGNED || r.name.toLowerCase().includes(kw) || (r.member?.note ?? "").toLowerCase().includes(kw))
      // 未指派置顶，其次名录成员，再按在制任务量降序
      .sort((a, b) =>
        Number(b.key === UNASSIGNED) - Number(a.key === UNASSIGNED) ||
        Number(Boolean(b.member)) - Number(Boolean(a.member)) ||
        b.active.length - a.active.length,
      );
  }, [tasks, roster, keyword, t]);

  const addMember = async (name: string) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    const userId = resolveAnyUserId(trimmed);
    if (!userId) { toast.error(t("找不到该用户（或存在同名，请确认姓名）")); return; }
    if (roster.some((m) => m.id === userId)) { toast.error(t("该成员已在名录中")); return; }
    setBusy(true);
    try {
      const r = await addBuyerRosterMember(userId);
      setRoster(r.members);
      setAddName("");
      toast.success(t("已加入采购成员名录：{name}", { name: trimmed }));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("添加失败"));
    } finally {
      setBusy(false);
    }
  };

  const autoAssign = async () => {
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
      toast.error(err instanceof Error ? err.message : t("自动分派失败"));
    } finally {
      setBusy(false);
    }
  };

  const removeMember = (member: BuyerRosterMember) =>
    confirmAction({
      title: t("移出成员名录"),
      desc: t("确定把 {name} 移出采购成员名录吗？历史任务不受影响。", { name: member.name }),
      tone: "danger",
      actionLabel: t("移出"),
      onConfirm: () => {
        setBusy(true);
        void removeBuyerRosterMember(member.id)
          .then((r) => { setRoster(r.members); toast.success(t("已从名录移除：{name}", { name: member.name })); })
          .catch((err: unknown) => toast.error(err instanceof Error ? err.message : t("移除失败")))
          .finally(() => setBusy(false));
      },
    });

  const saveNote = async (member: BuyerRosterMember) => {
    setBusy(true);
    try {
      const r = await updateBuyerRosterMember(member.id, noteDraft);
      setRoster(r.members);
      setEditingNote(null);
      toast.success(t("岗位备注已更新"));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("更新失败"));
    } finally {
      setBusy(false);
    }
  };

  const submitHandover = async (person: PersonRow) => {
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
    <div className="mx-auto flex h-full min-h-0 w-full max-w-[1200px] flex-col p-4">
      <PageHeader
        Icon={Users}
        badge={t("采购管理")}
        title={t("采购人员管理")}
        description={t("维护采购组成员名录（分配任务候选优先显示名录成员）；按负责人查看任务负载，离职/休假可一键整体交接。")}
        right={
          <button type="button" onClick={() => navigate(routePath("page:proc-cockpit", "/proc-cockpit"))} className="material-button-secondary inline-flex items-center gap-1.5 px-3 py-2 text-sm">
            <ArrowLeft className="h-4 w-4" />{t("返回驾驶舱")}
          </button>
        }
      />

      {/* 工具行：搜索 + 添加成员 */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <Input
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            placeholder={t("搜索姓名 / 岗位备注…")}
            className="h-9 w-64 rounded-lg border border-slate-200 bg-white pl-8 pr-3 text-sm outline-none focus:border-indigo-300"
          />
        </div>
        <span className="text-xs text-slate-400">{t("名录成员 {n} 人", { n: roster.length })}</span>
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
            <BuyerComboInput
              includeAll
              value={addName}
              onChange={setAddName}
              onEnter={() => void addMember(addName)}
              placeholder={t("输入姓名添加成员…")}
              className="h-9 w-56 rounded-lg border border-slate-200 bg-white px-3 text-sm outline-none focus:border-indigo-300"
            />
            <button type="button" disabled={busy || !addName.trim()} onClick={() => void addMember(addName)} className="material-button-primary inline-flex items-center gap-1.5 px-3 py-2 text-sm disabled:opacity-60">
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserPlus className="h-4 w-4" />}{t("添加成员")}
            </button>
          </div>
        )}
      </div>

      {/* 成员/负载列表 */}
      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto pb-4">
        {rows.length === 0 && <div className="material-card py-12 text-center text-sm text-slate-400">{t("暂无成员与在制任务；先在右上角添加采购组成员。")}</div>}
        {rows.map((p) => (
          <div key={p.key} className={cn("material-card p-4", p.key === UNASSIGNED && "border-amber-200 bg-amber-50/40")}>
            <div className="flex items-center gap-2">
              <PersonAvatar name={p.key === UNASSIGNED ? "?" : p.name} size="xs" />
              <span className="text-sm font-semibold text-slate-800">{p.name}</span>
              {p.member ? (
                <span className={cn("rounded-full border px-1.5 py-0.5 text-[10px]", p.member.disabled ? "border-slate-200 bg-slate-100 text-slate-400" : "border-indigo-200 bg-indigo-50 text-indigo-600")}>
                  {t(p.member.disabled ? "名录 · 账号已禁用" : p.member.managedByDepartment ? "采购部门同步" : "名录成员")}
                </span>
              ) : p.key !== UNASSIGNED ? (
                <span className="rounded-full border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-[10px] text-slate-400">{t("未入名录")}</span>
              ) : null}
              {p.key !== UNASSIGNED && deptOf(p.key) && <AutoTranslatedText as="span" className="text-[11px] text-slate-400" text={deptOf(p.key)!} />}
              {p.member?.note && editingNote !== p.member.id && (
                <AutoTranslatedText as="span" className="rounded bg-slate-50 px-1.5 py-0.5 text-[11px] text-slate-500" text={p.member.note} />
              )}
              <div className="ml-auto flex items-center gap-1.5">
                {canManage && p.member && (
                  <button type="button" onClick={() => { setEditingNote((cur) => (cur === p.member!.id ? null : p.member!.id)); setNoteDraft(p.member.note ?? ""); }} className="rounded-lg border border-slate-200 p-1.5 text-slate-500 hover:bg-slate-50" title={t("编辑岗位备注")}>
                    <Pencil className="h-3.5 w-3.5" />
                  </button>
                )}
                {canManage && !p.member && p.key !== UNASSIGNED && (
                  <button type="button" disabled={busy} onClick={() => void addMember(p.key)} className="rounded-lg border border-indigo-200 px-2 py-1 text-[11px] text-indigo-600 hover:bg-indigo-50" title={t("加入成员名录")}>
                    {t("入名录")}
                  </button>
                )}
                {canManage && (
                  <button type="button" onClick={() => { setHandover((cur) => (cur === p.key ? null : p.key)); setTarget(""); }} disabled={p.active.length === 0} className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-40">
                    <ArrowRightLeft className="h-3.5 w-3.5" />{t(p.key === UNASSIGNED ? "指派" : "交接")}
                  </button>
                )}
                {canManage && p.member && !p.member.managedByDepartment && (
                  <button type="button" disabled={busy} onClick={() => removeMember(p.member!)} className="rounded-lg border border-slate-200 p-1.5 text-slate-400 hover:bg-rose-50 hover:text-rose-500" title={t("从名录移除")}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            </div>

            {canManage && p.member && editingNote === p.member.id && (
              <div className="mt-2 flex items-center gap-2">
                <Input
                  autoFocus
                  value={noteDraft}
                  onChange={(e) => setNoteDraft(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") void saveNote(p.member!); if (e.key === "Escape") setEditingNote(null); }}
                  placeholder={t("岗位备注，如「电子料询价」「包材/耗材」")}
                  className="h-8 flex-1 rounded-lg border border-indigo-200 px-2 text-sm outline-none focus:border-indigo-400"
                />
                <button type="button" disabled={busy} onClick={() => void saveNote(p.member!)} className="rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-indigo-700 disabled:opacity-60">{t("保存")}</button>
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
      {confirmDialog}
    </div>
  );
}
