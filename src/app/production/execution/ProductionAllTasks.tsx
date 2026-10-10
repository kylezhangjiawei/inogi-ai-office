import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { useAuth } from '../../auth';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { NativeSelect } from '../../components/ui/native-select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../../components/ui/table';
import type { ExecutionPlan, ExecutionTask } from '../../lib/productionExecutionApi';
import { getLifecycle, type Lifecycle } from '../../lib/productionLifecycleApi';
import { ProductionEmpty, ProductionPagination, ProductionStatus } from './ProductionView';
import { productionPage, productionQuery, productionSearch, productionTaskState, productionPendingInspection } from './productionViewState';

type TaskKind = 'task' | 'inspection' | 'quality' | 'ecn' | 'transfer';
type TaskRow = { id: string; plan: ExecutionPlan; task?: ExecutionTask; kind: TaskKind; title: string; code: string; owner: string; batch?: string; status: string; open: boolean; due: string; dateLabel?: string; quantity?: number; unit?: string; action: string; section: string | null; lines: string[]; recordId?: string; note?: string };
const kindLabels = { task: '派工', inspection: '待终检', quality: '不良处理', ecn: 'ECN 确认', transfer: '转产办理' };

export function ProductionAllTasks({ plans }: { plans: ExecutionPlan[] }) {
  const [params, setParams] = useSearchParams();
  const { user } = useAuth();
  const permissions = user?.permissions ?? [];
  const can = (permission: string) => permissions.includes('*') || permissions.includes(permission);
  const singlePlan = plans.length === 1 ? plans[0] : undefined;
  const canReadLifecycle = Boolean(user && singlePlan && can('page:production-execution') && (['production:plan', 'production:view-all', 'production:inspect', 'production:transfer', 'production:release', 'production:ship', 'proc-quality:manage', 'proc-quality:verify'].some(can) || singlePlan.tasks.some(task => task.ownerId === user.id)));
  const readKey = canReadLifecycle ? JSON.stringify([singlePlan!.id, singlePlan!.version, user?.id, user?.roleId, permissions]) : '';
  const [lifecycle, setLifecycle] = useState<{ key: string; data?: Lifecycle; error?: string } | null>(null);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    if (!readKey || !singlePlan) return;
    const controller = new AbortController();
    setLifecycle(null);
    getLifecycle(singlePlan.id, controller.signal)
      .then(data => { if (!controller.signal.aborted) setLifecycle({ key: readKey, data }); })
      .catch(cause => { if (!controller.signal.aborted) setLifecycle({ key: readKey, error: cause instanceof Error ? cause.message : '转产与 ECN 待办读取失败' }); });
    return () => controller.abort();
  }, [readKey, retry]);
  const lifecycleResult = lifecycle?.key === readKey ? lifecycle : null;
  const kind = params.get('allKind') || 'all', line = params.get('allLine') || 'all', search = params.get('allQ') || '';
  const onlyOpen = params.get('allScope') !== 'all';
  const taskRows: TaskRow[] = plans.flatMap(plan => plan.tasks.map(task => {
    const state = productionTaskState(task), batch = plan.batches.find(row => row.id === task.batchId);
    return { id: 'task/' + task.id, plan, task, kind: 'task', title: task.name, code: task.id, owner: task.ownerName, batch: batch?.code, status: state.label, open: !['cancelled', 'reported'].includes(state.key), due: task.date, quantity: task.quantity, unit: task.unit, action: state.next, section: ['inspection', 'quality'].includes(state.key) ? 'quality' : null, lines: [task.line] };
  }));
  const inspectionRows: TaskRow[] = taskRows.filter(row => row.task!.status === 'dispatched' && productionPendingInspection(row.task!) > 0).map(row => ({ ...row, id: 'inspection/' + row.task!.id, kind: 'inspection', owner: '', status: '待终检', open: true, quantity: productionPendingInspection(row.task!), action: '进入检验', section: 'quality' }));
  const seenQuality = new Set<string>();
  const qualityRows: TaskRow[] = plans.flatMap(plan => plan.tasks.flatMap(task => [...task.inspections.flatMap(row => row.quality ? [row.quality] : []), ...(task.fieldIssues ?? []).flatMap(row => row.quality ? [row.quality] : [])].filter(record => {
    if (seenQuality.has(record.id)) return false; seenQuality.add(record.id); return true;
  }).map(record => ({ id: 'quality/' + record.id, plan, task, kind: 'quality', title: record.issue, code: record.id, owner: record.collaboration?.ownerName || '', batch: plan.batches.find(row => row.id === task.batchId)?.code, status: record.status === 'closed' ? '已关闭' : '待处理 / 验证', open: record.status !== 'closed', due: record.collaboration?.dueDate || '', quantity: record.defectiveQty, unit: record.unit || task.unit, action: '处理原异常', section: 'quality', lines: [task.line] }))));
  const ecnRows: TaskRow[] = singlePlan && lifecycleResult?.data ? lifecycleResult.data.changes.filter(change => change.status === 'published' && singlePlan.tasks.some(task => task.ownerId === user?.id && change.batchIds.includes(task.batchId)) && !change.acknowledgments.some(ack => ack.actorId === user?.id)).map(change => ({
    id: 'ecn/' + change.id, plan: singlePlan, kind: 'ecn', title: change.code, code: change.code, recordId: change.id, owner: user?.name || '本人', batch: singlePlan.batches.filter(batch => change.batchIds.includes(batch.id)).map(batch => batch.code).join('、'), status: '待本人确认阅读', open: true, due: change.effectiveDate, dateLabel: '生效日期', action: '查看并确认 ECN', section: 'ecn', lines: [...new Set(singlePlan.tasks.filter(task => change.batchIds.includes(task.batchId)).map(task => task.line))], note: '阅读确认仅表示已阅，执行验证与质量放行需分别办理。',
  })) : [];
  const transferRows: TaskRow[] = singlePlan && lifecycleResult?.data ? lifecycleResult.data.transfers.filter(transfer => transfer.type === 'validation' && ((transfer.status === 'draft' && can('production:release') && transfer.authorId !== user?.id) || (transfer.status === 'validated' && can('production:transfer')))).map(transfer => ({
    id: 'transfer/' + transfer.id, plan: singlePlan, kind: 'transfer', title: transfer.code, code: transfer.code, recordId: transfer.id, owner: transfer.status === 'draft' ? '授权独立验证人' : '授权发布人', status: transfer.status === 'draft' ? '待独立验证' : '待发布', open: true, due: '', dateLabel: '办理期限', action: transfer.status === 'draft' ? '查看并独立验证' : '查看并发布资料', section: 'transfer', lines: [], note: '此项为当前计划的资料包待办，不计入派工、待检或不良数量。进入原资料核对后办理。',
  })) : [];
  const all = [...taskRows, ...inspectionRows, ...qualityRows, ...ecnRows, ...transferRows];
  const rows = all.filter(row => (kind === 'all' || row.kind === kind) && (!onlyOpen || row.open) && (line === 'all' || row.lines.includes(line)) && productionSearch(search, [row.title, row.code, row.owner, row.batch, row.plan.productLine]));
  const page = productionPage(rows, params.get('allPage'), 8), selected = rows.find(row => row.id === params.get('allSelected')) ?? page.rows[0];
  const filter = (key: string, value: string) => setParams(previous => productionQuery(previous, { [key]: value, allPage: null, allSelected: null }), { replace: true });
  const href = (row: TaskRow) => '?' + productionQuery(params, {
    plan: row.plan.id, view: row.kind === 'quality' ? 'quality' : row.kind === 'ecn' ? 'ecn' : row.recordId ? 'transfer' : 'tasks', task: row.kind === 'quality' || row.recordId ? null : row.task!.id,
    taskFrom: row.recordId ? null : 'all-tasks', workbench: row.recordId || params.has('plan') ? null : 'all-tasks', taskSection: row.recordId ? null : row.section,
    inspection: null, record: row.recordId ?? null, recordType: row.recordId ? row.kind : null, quality: row.kind === 'quality' ? row.code : null,
  });
  return <div className="pp-all-layout">
    <section className="production-surface">
      <div className="production-section-heading"><h2>生产全部任务</h2><span className="production-note">按业务记录列示，各类数量分别核对</span></div>
      <div className="px-4 pb-3 text-xs leading-relaxed text-muted-foreground">
        {!singlePlan ? '跨计划显示派工、待终检与原异常。选择单一计划后，可补充本人可办理的 ECN 确认与转产待办。' : !canReadLifecycle ? '当前显示派工、待终检与原异常；未读取无权查看的转产与 ECN 记录。' : <><p>ECN 与转产仅补充当前计划 {singlePlan.productLine} · {singlePlan.month} 中本人可办理的待办，不包含已办记录。</p>{!lifecycleResult ? <p role="status">正在读取转产与 ECN 待办…</p> : lifecycleResult.error ? <div role="alert"><p>转产与 ECN 待办读取失败，已有任务仍可查看。{lifecycleResult.error}</p><Button variant="outline" size="sm" onClick={() => setRetry(value => value + 1)}>重新读取补充待办</Button></div> : null}</>}
      </div>
      <div className="pp-type-tabs" role="group" aria-label="任务类型">{[['all', '全部任务', all.length], ['task', '现场派工', taskRows.length], ['inspection', '待终检', inspectionRows.length], ['quality', '不良处理', qualityRows.length], ['ecn', 'ECN 确认', lifecycleResult?.data ? ecnRows.length : '—'], ['transfer', '转产办理', lifecycleResult?.data ? transferRows.length : '—']].map(([value, label, count]) => <Button key={value} variant={kind === value ? 'secondary' : 'ghost'} size="sm" aria-pressed={kind === value} onClick={() => filter('allKind', String(value))}>{label}<small>{count}</small></Button>)}</div>
      <div className="production-toolbar"><Input aria-label="搜索全部生产任务" placeholder="任务、生产单、资料或负责人" value={search} onChange={event => filter('allQ', event.target.value)} /><NativeSelect aria-label="全部任务产线" value={line} onChange={event => filter('allLine', event.target.value)}><option value="all">全部产线</option>{[...new Set(taskRows.flatMap(row => row.lines))].filter(Boolean).map(value => <option key={value}>{value}</option>)}</NativeSelect><NativeSelect aria-label="全部任务状态" value={onlyOpen ? 'open' : 'all'} onChange={event => filter('allScope', event.target.value)}><option value="open">待办理</option><option value="all">全部记录</option></NativeSelect></div>
      {!!rows.length && <p className="pp-mobile-table-hint">左右滑动查看状态与操作，任务列保持可见</p>}
      {!rows.length ? <ProductionEmpty title="当前范围没有任务" /> : <Table className="production-table"><TableHeader><TableRow>{['任务 / 生产单', '业务类型', '当前经办', '期限 / 生效', '状态', '查看'].map(label => <TableHead key={label}>{label}</TableHead>)}</TableRow></TableHeader><TableBody>{page.rows.map(row => <TableRow key={row.id} data-state={selected?.id === row.id ? 'selected' : undefined}><TableCell className="production-cell-main"><strong>{row.title}</strong><p className="production-meta">{row.plan.productLine} · {row.batch || '计划资料'}</p></TableCell><TableCell>{kindLabels[row.kind]}</TableCell><TableCell>{row.owner || '待确认'}</TableCell><TableCell>{row.due ? <>{row.due}{row.dateLabel && <p className="production-meta">{row.dateLabel}</p>}</> : '未指定'}</TableCell><TableCell><ProductionStatus tone={row.open ? 'warning' : 'neutral'}>{row.status}</ProductionStatus></TableCell><TableCell><Button size="sm" variant="ghost" onClick={() => setParams(previous => productionQuery(previous, { allSelected: row.id }), { replace: true })}>查看</Button></TableCell></TableRow>)}</TableBody></Table>}<ProductionPagination {...page} onPageChange={value => setParams(previous => productionQuery(previous, { allPage: String(value), allSelected: null }))} />
    </section>
    <aside className="production-surface"><div className="production-section-heading"><h2>任务详情</h2></div>{selected ? <><div className="pp-all-detail-title"><ProductionStatus tone={selected.open ? 'warning' : 'neutral'}>{selected.status}</ProductionStatus><h3>{selected.title}</h3></div><dl className="pp-detail-fields"><div><dt>{selected.recordId ? '资料编号' : '任务编号'}</dt><dd>{selected.code}</dd></div><div><dt>{selected.recordId ? '适用生产单' : '生产单号'}</dt><dd>{selected.batch || (selected.kind === 'transfer' ? '当前计划资料，尚未指定批次' : '待确认')}</dd></div><div><dt>产品型号</dt><dd>{selected.plan.productLine}</dd></div><div><dt>所属产线</dt><dd>{selected.lines.filter(Boolean).join('、') || '不限定单一产线'}</dd></div><div><dt>当前经办</dt><dd>{selected.owner || '待确认'}</dd></div><div><dt>{selected.dateLabel || '期限'}</dt><dd>{selected.due || '未指定'}</dd></div>{selected.quantity != null && <div><dt>{selected.kind === 'quality' ? '不良数量' : selected.kind === 'inspection' ? '待检数量' : '计划数量'}</dt><dd>{selected.quantity} {selected.unit}</dd></div>}</dl>{selected.note && <p className="px-4 pb-4 text-xs leading-relaxed text-muted-foreground">{selected.note}</p>}<div className="pp-detail-actions"><Button asChild><Link to={href(selected)}>{selected.action}</Link></Button></div></> : <ProductionEmpty title="选择一项任务查看" />}</aside>
  </div>;
}
