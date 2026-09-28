// 采购成员名录：维护成员关系和岗位备注，只读展示成员任务数量。
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { ArrowLeft, Loader2, Pencil, Search, UserPlus, X } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "../auth";
import { usePermission } from "../hooks/usePermission";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Checkbox } from "../components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../components/ui/table";
import { PersonAvatar, useConfirmDialog } from "./components/common";
import { addBuyerRosterMember, removeBuyerRosterMember, updateBuyerRosterMember, getBuyerRoster, listBuyerCandidates, type BuyerCandidate, type BuyerRosterMember } from "../lib/procurementApi";
import { useI18n } from "../lib/i18n";
import { routePath } from "../lib/routePaths";
import { refreshProcurement, useProcurementData } from "./data";
import { resolveProcurementOwner, uniqueRosterUserIdsByName } from "./procurementLogic";

export function ProcPeopleManagementPage() {
  const { user } = useAuth();
  const scope = JSON.stringify([user?.id, user?.roleId, [...(user?.permissions ?? [])].sort()]);
  return <ProcPeopleManagementContent key={scope} />;
}

function ProcPeopleManagementContent() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const canManage = usePermission("proc-task:reassign");
  const { tasks, loading: tasksLoading, error: tasksError } = useProcurementData();
  const { confirm: confirmAction, confirmDialog } = useConfirmDialog();
  const [roster, setRoster] = useState<BuyerRosterMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const requestRef = useRef(0);
  const [users, setUsers] = useState<BuyerCandidate[]>([]);
  const [usersLoading, setUsersLoading] = useState(false);
  const [usersError, setUsersError] = useState("");
  const [usersVersion, setUsersVersion] = useState(0);
  const [keyword, setKeyword] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [addUserId, setAddUserId] = useState("");
  const [editingNote, setEditingNote] = useState(false);
  const [noteDraft, setNoteDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [actionError, setActionError] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);
  const addTriggerRef = useRef<HTMLButtonElement>(null);
  const noteTriggerRef = useRef<HTMLButtonElement>(null);
  const loadRoster = useCallback(async () => {
    const request = ++requestRef.current;
    setLoading(true); setError("");
    try { const result = await getBuyerRoster(); if (request === requestRef.current) setRoster(result.members); }
    catch (cause) { if (request === requestRef.current) setError(cause instanceof Error ? cause.message : t("成员名录加载失败")); }
    finally { if (request === requestRef.current) setLoading(false); }
  }, [t]);
  useEffect(() => { void loadRoster(); return () => { requestRef.current++; }; }, [loadRoster]);
  useEffect(() => {
    if (!adding || !canManage) return;
    const controller = new AbortController();
    setUsersLoading(true); setUsersError(""); setUsers([]);
    // 与用户管理共用系统用户表；采购接口只返回选择成员需要的身份字段。
    void listBuyerCandidates(controller.signal, "all").then(result => {
      if (!controller.signal.aborted) setUsers(result);
    }).catch(cause => { if (!controller.signal.aborted) setUsersError(cause instanceof Error ? cause.message : t("用户列表加载失败")); })
      .finally(() => { if (!controller.signal.aborted) setUsersLoading(false); });
    return () => controller.abort();
  }, [adding, canManage, usersVersion, t]);
  const taskCounts = useMemo(() => {
    const uniqueNameIds = uniqueRosterUserIdsByName(roster);
    const counts = new Map<string, number>();
    for (const task of tasks) {
      const { userId } = resolveProcurementOwner(task, uniqueNameIds, "unassigned");
      if (userId) counts.set(userId, (counts.get(userId) ?? 0) + 1);
    }
    return counts;
  }, [tasks, roster]);
  const rows = useMemo(() => {
    const query = keyword.trim().toLowerCase();
    return roster.filter(member => !query || [member.name, member.department, member.note, member.id].some(value => value?.toLowerCase().includes(query)));
  }, [roster, keyword]);
  const selected = !loading && !error ? rows.find(member => member.id === selectedId) : undefined;
  const availableUsers = users.filter(user => !roster.some(member => member.id === user.id));
  const addCandidate = !usersLoading && !usersError ? availableUsers.find(user => user.id === addUserId && !user.disabled) : undefined;
  const selectMember = (id: string | null) => {
    if (busyRef.current) return;
    setSelectedId(id); setEditingNote(false); setActionError("");
  };
  const closeForm = () => {
    if (busyRef.current) return;
    (adding ? addTriggerRef : noteTriggerRef).current?.focus();
    setAdding(false); setEditingNote(false); setActionError("");
  };
  const saveMember = async (kind: "add" | "note") => {
    if (!canManage || busyRef.current || loading || error) return;
    if (kind === "add" ? !addCandidate : !selected) return;
    busyRef.current = true; setBusy(true); setActionError("");
    try {
      const result = kind === "add" ? await addBuyerRosterMember(addCandidate!.id) : await updateBuyerRosterMember(selected!.id, noteDraft);
      setRoster(result.members); setAdding(false); setEditingNote(false); setAddUserId("");
      toast.success(t(kind === "add" ? "成员已添加" : "岗位备注已更新"));
    } catch (cause) { setActionError(cause instanceof Error ? cause.message : t("保存失败，请重试")); }
    finally { busyRef.current = false; setBusy(false); }
  };
  const requestRemove = () => {
    if (!canManage || !selected || busyRef.current) return;
    const member = selected;
    confirmAction({ title: t("移出成员"), desc: t("将「{name}」移出当前名录？不会删除系统用户，也不会修改已有任务。", { name: member.name }), tone: "danger", actionLabel: t("确认移出"),
      onConfirm: async () => {
        if (busyRef.current) return false;
        busyRef.current = true; setBusy(true);
        try { const result = await removeBuyerRosterMember(member.id); setRoster(result.members); setSelectedId(null); setEditingNote(false); setActionError(""); toast.success(t("成员已移出")); }
        finally { busyRef.current = false; setBusy(false); }
      },
    });
  };
  return <div className="proc-horizon proc-people-page mx-auto min-h-full min-w-0 w-full max-w-[1600px] pb-4">
    <section className="proc-horizon-surface material-card overflow-hidden">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-4">
        <div><h2 className="text-balance text-base font-semibold">{t("人员列表")}</h2><p className="mt-1 text-pretty text-sm text-muted-foreground">{t("从系统用户中添加成员，维护名录和岗位备注。")}</p></div>
        <Button variant="outline" disabled={busy} onClick={() => navigate(routePath("page:proc-cockpit", "/proc-cockpit"))}><ArrowLeft className="size-4" />{t("返回驾驶舱")}</Button>
      </header>
      <div aria-label={t("成员管理操作")} className="flex flex-wrap items-center gap-2 px-5 pt-4">
        {canManage && <>
          <Button ref={addTriggerRef} className="bg-primary text-primary-foreground" disabled={busy || loading || Boolean(error)} onClick={() => { setAdding(!adding); setEditingNote(false); setAddUserId(""); setActionError(""); }}><UserPlus className="size-4" />{t("添加成员")}</Button>
          <Button ref={noteTriggerRef} variant="outline" disabled={busy || !selected} onClick={() => { if (!selected) return; setEditingNote(true); setNoteDraft(selected.note ?? ""); setAdding(false); setActionError(""); }}><Pencil className="size-4" />{t("编辑岗位备注")}</Button>
          <Button variant="outline" disabled={busy || !selected} onClick={requestRemove}><X className="size-4" />{t("移出成员")}</Button>
        </>}
      </div>
      <div className="flex flex-wrap items-center gap-3 px-5 py-4">
        <div className="relative w-full max-w-sm"><Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" /><Input ref={searchRef} disabled={busy} aria-label={t("搜索成员")} placeholder={t("搜索姓名 / 部门 / 岗位备注")} value={keyword} onChange={event => { setKeyword(event.target.value); selectMember(null); }} className="pl-9 pr-9" />{keyword && <Button variant="ghost" aria-label={t("清空搜索")} disabled={busy} className="absolute right-0 top-0 size-9 p-0" onClick={() => { setKeyword(""); searchRef.current?.focus(); }}><X className="size-4" /></Button>}</div>
        <span role="status" className="text-sm tabular-nums text-muted-foreground">{loading ? t("加载中") : error ? "—" : t("显示 {count} / {total} 位成员", { count: rows.length, total: roster.length })}</span>
        {selected && <span className="ml-auto text-sm text-muted-foreground">{t("已选择：{name}", { name: selected.name })}</span>}
      </div>
      {canManage && adding && <div className="mx-5 mb-4 space-y-3 rounded-xl border border-border bg-muted/30 p-4">
        <p className="text-sm font-medium">{t("添加系统用户为成员")}</p>
        <div className="flex flex-wrap gap-2">
          <Select disabled={busy || usersLoading || Boolean(usersError)} value={addCandidate?.id ?? ""} onValueChange={value => { setAddUserId(value); setActionError(""); }}>
            <SelectTrigger aria-label={t("待添加用户")} className="w-full sm:w-96"><SelectValue placeholder={t(usersLoading ? "正在加载系统用户…" : "请选择系统用户")} /></SelectTrigger>
            <SelectContent>{availableUsers.map(user => <SelectItem key={user.id} value={user.id} disabled={user.disabled}>{user.name}{user.department ? " · " + user.department : ""}{users.filter(other => other.name === user.name).length > 1 ? " · " + user.id : ""}{user.disabled ? " · " + t("账号未启用") : ""}</SelectItem>)}{!usersLoading && !usersError && availableUsers.length === 0 && <p className="px-3 py-2 text-sm text-muted-foreground">{t("暂无可添加用户")}</p>}</SelectContent>
          </Select>
          <Button disabled={busy || !addCandidate} onClick={() => void saveMember("add")}>{busy && <Loader2 className="size-4 animate-spin" />}{t("确认添加")}</Button><Button variant="ghost" disabled={busy} onClick={closeForm}>{t("取消")}</Button>
        </div>
        {usersError && <div role="alert" className="flex flex-wrap items-center gap-2 text-sm text-rose-700"><span>{usersError}</span><Button variant="outline" onClick={() => setUsersVersion(value => value + 1)}>{t("重新加载用户")}</Button></div>}
      </div>}
      {canManage && selected && editingNote && <div className="mx-5 mb-4 space-y-3 rounded-xl border border-border bg-muted/30 p-4">
        <p className="text-sm font-medium">{t("编辑岗位备注")} · {selected.name}</p><div className="flex flex-wrap gap-2"><Input autoFocus aria-label={t("岗位备注")} disabled={busy} maxLength={100} value={noteDraft} onChange={event => setNoteDraft(event.target.value)} onKeyDown={event => { if (event.key === "Escape") closeForm(); if (event.key === "Enter" && !event.nativeEvent.isComposing) void saveMember("note"); }} className="w-full sm:w-96" /><Button disabled={busy} onClick={() => void saveMember("note")}>{t("保存岗位备注")}</Button><Button variant="ghost" disabled={busy} onClick={closeForm}>{t("取消")}</Button></div>
      </div>}
      {error && <div role="alert" className="mx-5 mb-4 flex flex-wrap items-center gap-3 rounded-lg bg-rose-50 p-3 text-sm text-rose-700"><span>{error}</span><Button variant="outline" onClick={() => void loadRoster()}>{t("重试")}</Button></div>}
      {actionError && <p role="alert" className="mx-5 mb-4 rounded-lg bg-rose-50 p-3 text-sm text-rose-700">{actionError}</p>}
      {tasksError && <div role="alert" className="mx-5 mb-4 flex flex-wrap items-center gap-3 rounded-lg bg-rose-50 p-3 text-sm text-rose-700"><span>{t("任务数量加载失败")}</span><Button variant="outline" onClick={() => void refreshProcurement()}>{t("重新加载任务数量")}</Button></div>}
      <Table aria-label={t("采购成员列表")} className="min-w-[760px]" containerClassName="border-t border-border">
        <TableHeader><TableRow>{["选择", "姓名", "所属部门", "岗位备注", "账号状态", "任务数量"].map(label => <TableHead key={label} scope="col" className="px-4 py-3" title={label === "任务数量" ? t("当前权限范围内该成员负责的全部采购任务，含已完成任务") : undefined}>{t(label)}</TableHead>)}</TableRow></TableHeader>
        <TableBody>
          {loading && <TableRow><TableCell colSpan={6} className="py-12 text-center text-muted-foreground">{t("加载中")}…</TableCell></TableRow>}
          {!loading && !error && rows.length === 0 && <TableRow><TableCell colSpan={6} className="py-12 text-center text-muted-foreground">{t(keyword.trim() ? "没有匹配的成员" : "暂无成员，请从系统用户中添加")}</TableCell></TableRow>}
          {!loading && !error && rows.map(member => <TableRow key={member.id} aria-selected={selected?.id === member.id} data-state={selected?.id === member.id ? "selected" : undefined} className="cursor-pointer" onClick={event => { if (!(event.target as HTMLElement).closest('button, input, a')) selectMember(member.id); }}>
            <TableCell className="w-16 px-4 py-4"><Checkbox disabled={busy} checked={selected?.id === member.id} aria-label={t("选择成员：{name}", { name: member.name }) + " · " + member.id} onCheckedChange={checked => selectMember(checked ? member.id : null)} /></TableCell>
            <TableCell className="px-4"><div className="flex items-center gap-2"><PersonAvatar name={member.name} size="xs" /><span className="font-medium">{member.name}</span></div>{roster.some(other => other.id !== member.id && other.name === member.name) && <span className="mt-1 block text-xs text-muted-foreground">{member.id}</span>}</TableCell>
            <TableCell className="px-4">{member.department || "—"}</TableCell><TableCell className="max-w-96 whitespace-normal break-words px-4">{member.note || "—"}</TableCell><TableCell className="px-4 text-muted-foreground">{t(member.disabled ? "已停用" : "已启用")}</TableCell>
            <TableCell className="px-4 font-medium tabular-nums" aria-label={t("任务数量")}>{tasksLoading || tasksError ? <span className="text-muted-foreground" title={t(tasksLoading ? "任务数量加载中" : "任务数量加载失败")}>—</span> : taskCounts.get(member.id) ?? 0}</TableCell>
          </TableRow>)}
        </TableBody>
      </Table>
    </section>
    {confirmDialog}
  </div>;
}
