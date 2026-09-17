import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { useAuth } from '../../auth';
import { usePermission } from '../../hooks/usePermission';
import { buildPurchaseOrderLinePath } from '../../lib/purchaseOrderLineNavigation';
import { assignOperationalTask, fetchOperationalCandidates, fetchOperationalTasks, type OperationalCandidate, type OperationalKind, type OperationalTask, type OperationalTaskPage } from '../../lib/operationalTasksApi';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '../../components/ui/dialog';
import { NativeSelect } from "../../components/ui/native-select";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Textarea } from "../../components/ui/textarea";
const control = 'min-h-10 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm disabled:opacity-50';
export function OperationalTasksPanel({ personal = false }: { personal?: boolean }) {
  const { user } = useAuth();
  const scope = JSON.stringify([user?.id, user?.permissions]);
  return <OperationalTasksContent key={`${scope}:${personal}`} personal={personal} />;
}
function OperationalTasksContent({ personal }: { personal: boolean }) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const allowed = usePermission('page:purchase-order-detail');
  const assignmentPermission = usePermission('proc-operations:assign');
  const managementPermission = usePermission('page:proc-cockpit');
  const warehousePermission = usePermission('proc-purchase-order:receive');
  const canAssign = !personal && assignmentPermission;
  const canManage = !personal && managementPermission;
  const [kind, setKind] = useState<OperationalKind>(personal && !warehousePermission && !managementPermission ? 'quality' : 'warehouse');
  const [owner, setOwner] = useState(canManage ? 'all' : user?.id ?? ''), [status, setStatus] = useState('active');
  const [page, setPage] = useState<OperationalTaskPage | null>(null), [reminders, setReminders] = useState<OperationalTaskPage | null>(null);
  const [candidates, setCandidates] = useState<OperationalCandidate[]>([]);
  const [cursors, setCursors] = useState<string[]>(['']);
  const [reload, setReload] = useState(0), [loading, setLoading] = useState(false), [error, setError] = useState('');
  const [selected, setSelected] = useState<OperationalTask | null>(null);
  const [target, setTarget] = useState(''), [due, setDue] = useState(''), [note, setNote] = useState(''), [saving, setSaving] = useState(false), [saveError, setSaveError] = useState('');
  const busy = useRef(false), requestId = useRef('');
  const opener = useRef<HTMLElement | null>(null), alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const monthStart = new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString().slice(0, 7) + '-01';
  const cursor = cursors[cursors.length - 1];
  useEffect(() => {
    if (!allowed) return;
    const controller = new AbortController(); setLoading(true); setError('');
    void Promise.all([
      fetchOperationalTasks({ kind, owner, status, cursor }, controller.signal),
      fetchOperationalTasks({ kind, owner, status: 'active', before: monthStart }, controller.signal),
      canAssign && canManage ? fetchOperationalCandidates(controller.signal) : Promise.resolve([]),
    ]).then(([next, reminders, people]) => { if (!controller.signal.aborted) { setPage(next); setReminders(reminders); setCandidates(people); } })
      .catch(error => { if (!controller.signal.aborted) { setError(error.message); setPage(null); setReminders(null); } })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [allowed, kind, owner, status, cursor, monthStart, reload, canAssign, canManage]);
  const open = (task: OperationalTask, element: HTMLElement) => {
    opener.current = element; setSelected(task); setTarget(task.assignment?.userId ?? ''); setDue(task.assignment?.dueDate ?? task.dueDate ?? ''); setNote(''); setSaveError(''); requestId.current = crypto.randomUUID();
  };
  const save = async () => {
    if (!selected || busy.current) return;
    if (!note.trim()) { setSaveError('请填写分派或交接原因'); return; }
    busy.current = true; setSaving(true); setSaveError('');
    try {
      const assignment = await assignOperationalTask(selected, { userId: target, note, dueDate: due || null, expectedVersion: selected.assignment?.version ?? 0, requestId: requestId.current });
      if (alive.current) { setSelected({ ...selected, assignment }); setNote(''); requestId.current = crypto.randomUUID(); setReload(value => value + 1); }
    } catch (error) { if (alive.current) setSaveError(error instanceof Error ? error.message : '分派失败'); }
    finally { busy.current = false; if (alive.current) setSaving(false); }
  };
  const link = (task: OperationalTask) => { const path = buildPurchaseOrderLinePath(task.orderNo, task.lineId); if (path) navigate(path); };
  return <section className="material-card mb-4 space-y-3 p-4" aria-label="仓管与质量人员任务">
    <div><h2 className="text-base font-semibold text-slate-900">仓管与质量人员任务</h2><p className="mt-1 text-xs leading-5 text-slate-500">按原订单行和收货批次分派负责人。收货或检验登记人保留为操作记录，完成情况随原业务更新。</p></div>
    {!allowed ? <p className="text-sm text-amber-700">需要采购订单详情权限才能读取原业务任务。</p> : <>
      <div className="flex flex-wrap gap-2">
        <NativeSelect aria-label="岗位任务" className={control} value={kind} onChange={event => { setKind(event.target.value as OperationalKind); setOwner(canManage ? 'all' : user?.id ?? ''); setCursors(['']); }}><option value="warehouse">仓管待收货</option><option value="quality">质量待检验</option></NativeSelect>
        <NativeSelect aria-label="任务负责人" className={control} value={owner} onChange={event => { setOwner(event.target.value); setCursors(['']); }}>
          {!personal && (page?.canViewAll ?? canManage) && <><option value="all">全部负责人</option><option value="unassigned">待分配</option></>}
          <option value={user?.id ?? ''}>我的任务</option>{!personal && page?.canViewAll && page.people.filter(person => person.id !== user?.id).map(person => <option key={person.id} value={person.id}>{person.name} · {person.id.slice(-6)}</option>)}
        </NativeSelect>
        <NativeSelect aria-label="岗位任务状态" className={control} value={status} onChange={event => { setStatus(event.target.value); setCursors(['']); }}><option value="active">未完成</option><option value="completed">已完成</option><option value="all">全部历史</option></NativeSelect>
        <Button variant="unstyled" type="button" className={control} disabled={loading} onClick={() => setReload(value => value + 1)}>刷新岗位任务</Button>
      </div>
      {loading && <p role="status" className="text-sm text-slate-500">正在读取原业务任务…</p>}
      {error && <p role="alert" className="text-sm text-rose-700">{error}</p>}
      {!loading && reminders && reminders.items.length > 0 && <details className="rounded-xl border border-amber-200 bg-amber-50 p-3"><summary className="cursor-pointer text-sm font-medium text-amber-900">跨月未完成 · {reminders.items.length}{reminders.nextCursor ? '+' : ''} 项</summary><p className="my-2 text-xs text-amber-800">按当前负责人查询，独立于上方完成状态；更多记录可在未完成任务中翻页。</p><div className="grid gap-2 sm:grid-cols-2">{reminders.items.map(task => <Button variant="unstyled" className="rounded-lg bg-white p-2 text-left text-xs" type="button" key={task.id} onClick={() => link(task)}>{task.orderNo} / {task.lineNo} · {task.materialName} · {task.dueDate}</Button>)}</div></details>}
      {!loading && page && <>
        <p className="text-xs text-slate-500">{!personal && page.canViewAll ? '当前权限可见订单' : '仅本人已分派任务'} · 本页 {page.items.length} 项</p>
        {page.items.length === 0 && <p className="py-5 text-sm text-slate-500">当前条件下没有岗位任务。</p>}
        <div className="grid gap-3 lg:grid-cols-2">{page.items.map(task => <article className="space-y-2 rounded-xl border border-slate-200 p-3" key={task.id}>
          <div className="flex flex-wrap justify-between gap-2"><h3 className="text-sm font-semibold">{task.materialName || '未命名物料'}</h3><span className="text-xs text-slate-500">{task.state}</span></div>
          <p className="text-xs text-slate-600">{task.orderNo} · 第 {task.lineNo} 行{task.deliveryNo ? ` · 送货单 ${task.deliveryNo}` : ''}</p>
          <p className="text-sm">{task.assignment?.name || '待分配'} · 截止 {task.dueDate || '待确认'} · {task.quantity === null ? '数量待核对' : `${task.quantity} ${task.unit}`}</p>
          <p className="text-xs text-slate-500">{task.quantityBasis}</p>
          <div className="flex gap-2"><Button variant="unstyled" type="button" className={control} onClick={() => link(task)}>打开原单处理</Button><Button variant="unstyled" type="button" className={control} onClick={event => open(task, event.currentTarget)}>{canAssign && page.canAssign ? '分派与交接' : '查看分派记录'}</Button></div>
        </article>)}</div>
        <div className="flex items-center justify-end gap-3"><Button variant="unstyled" className={control} disabled={cursors.length === 1} onClick={() => setCursors(value => value.slice(0, -1))}>上一页</Button><span className="text-xs">第 {cursors.length} 页</span><Button variant="unstyled" className={control} disabled={!page.nextCursor} onClick={() => setCursors(value => [...value, page.nextCursor!])}>下一页</Button></div>
      </>}
    </>}
    <Dialog open={Boolean(selected)} onOpenChange={open => { if (!open && !busy.current) setSelected(null); }}><DialogContent aria-modal="true" closeDisabled={saving} className="horizon-theme horizon-portal proc-horizon-overlay max-h-[90dvh] overflow-y-auto" onCloseAutoFocus={event => { if (opener.current?.isConnected) { event.preventDefault(); opener.current.focus(); } }}>
      <DialogHeader><DialogTitle>岗位任务分派与历史</DialogTitle><DialogDescription>{selected?.orderNo} · {selected?.materialName}</DialogDescription></DialogHeader>
      {canAssign && page?.canAssign && <div className="space-y-3">
        <label className="grid gap-1 text-xs">负责人<NativeSelect className={control} disabled={saving} value={target} onChange={event => setTarget(event.target.value)}><option value="">暂不分配</option>{candidates.filter(person => person.kinds.includes(kind)).map(person => <option key={person.id} value={person.id}>{person.name} · {person.department || '未设置部门'} · {person.id.slice(-6)}</option>)}</NativeSelect></label>
        <label className="grid gap-1 text-xs">截止日期<Input type="date" className={control} disabled={saving} value={due} onChange={event => setDue(event.target.value)} /></label>
        <label className="grid gap-1 text-xs">分派或交接原因<Textarea className={control} disabled={saving} maxLength={1000} value={note} onChange={event => setNote(event.target.value)} /></label>
        {saveError && <p role="alert" className="text-sm text-rose-700">{saveError}</p>}
        <Button variant="unstyled" type="button" className="material-button-primary min-h-10 px-4 py-2 text-sm" disabled={saving} onClick={() => void save()}>{saving ? '正在保存…' : '保存分派'}</Button>
      </div>}
      <h3 className="text-sm font-semibold">分派历史</h3>{!selected?.assignment?.history.length && <p className="text-xs text-slate-500">尚无分派记录，登记收货或检验不会自动指定负责人。</p>}
      {selected?.assignment?.history.slice().reverse().map(row => <div className="border-t border-slate-100 py-2 text-xs" key={row.version}><p>第 {row.version} 次 · {row.name || '待分配'} · 截止 {row.dueDate || '未设置'}</p><p className="mt-1 break-words text-slate-500">{row.note} · {new Date(row.at).toLocaleString('zh-CN')}</p></div>)}
    </DialogContent></Dialog>
  </section>;
}
