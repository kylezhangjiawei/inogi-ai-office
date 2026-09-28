import { useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { AlertTriangle, ChevronDown, ClipboardList, PackageCheck, RefreshCw, Warehouse } from 'lucide-react';
import { useAuth } from '../../auth';
import { useI18n } from '../../lib/i18n';
import { routePath, subRoutePath } from '../../lib/routePaths';
import { hasPermission } from '../../lib/permissions';
import { getWarehouseRecords } from '../../lib/warehouseRecordsApi';
import { getWarehouseFlows, type WarehouseIssue } from '../../lib/warehouseFlowApi';
import { Button } from '../../components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '../../components/ui/dropdown-menu';
import { Input } from '../../components/ui/input';
import { NativeSelect } from '../../components/ui/native-select';
import { Skeleton } from '../../components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../../components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../../components/ui/table';
import { WarehouseReconcileEditor, WarehouseIssueEditor } from '../../procurement/WarehouseFlowPage';
import { WarehouseRecordsPanel } from '../../procurement/WarehouseRecordsPanel';
import { WarehousePagination } from '../../procurement/warehouse-flow/WarehousePagination';
import { WAREHOUSE_STATUS, WAREHOUSE_CHECK_STATUS, latestWarehouseCheck, warehousePage, warehouseQuery, warehouseSearch } from '../../procurement/warehouse-flow/warehouseViewState';
import { OrderEmptyState, OrderPageHeader } from '../components/HorizonPage';
import { warehouseCockpitAccess, warehouseIssueSummary, useWarehouseResource } from './warehouseCockpitState';
import '../horizon.css';
import '../../procurement/warehouse-flow/warehouseFlow.css';
import './warehouseCockpit.css';

// Include settled issues so their signed materials remain available for returns.
const loadFlows = (signal: AbortSignal) => getWarehouseFlows('', 'all', signal);
const loadRecords = (signal: AbortSignal) => getWarehouseRecords(signal);
const number = (value: number) => value.toLocaleString('zh-CN', { maximumFractionDigits: 3 });
const tabs = { picking: '待配料', issues: '领料', receipts: '收货入库', returns: '退料接收' };

export function WarehouseWorkbench() {
  const { user } = useAuth();
  return <WarehouseWorkbenchContent key={JSON.stringify([user?.id, user?.roleId, [...(user?.permissions ?? [])].sort()])} />;
}

function WarehouseWorkbenchContent() {
  const { user } = useAuth(), { t } = useI18n();
  const access = warehouseCockpitAccess(user?.permissions ?? []);
  const [params, setParams] = useSearchParams();
  const rawTab = params.get('workbenchTab') ?? (params.get('warehouseView') === 'records' || params.has('record') ? 'records' : params.has('issue') || params.has('taskId') || params.has('issueQ') ? 'issues' : 'picking');
  const tab = rawTab === 'records' ? 'records' : Object.hasOwn(tabs, rawTab) ? rawTab as keyof typeof tabs : 'picking';
  const [version, setVersion] = useState(0);
  const [editor, setEditor] = useState<{ issue: WarehouseIssue; action: 'issue' | 'sign' } | null>(null);
  const [checkEditor, setCheckEditor] = useState<{ issue: WarehouseIssue; event: WarehouseIssue['history'][number]; revoke: boolean } | null>(null);
  const records = useWarehouseResource(access.flows ? `records:${version}` : null, loadRecords);
  const flows = useWarehouseResource(access.flows ? `flows:${version}` : null, loadFlows);
  const allIssues = flows.data?.items ?? [];
  const summary = warehouseIssueSummary(allIssues);
  const search = params.get('dispatchQ') ?? params.get('issueQ') ?? '', status = params.get('dispatchStatus') ?? params.get('issueStatus') ?? 'all';
  const source = tab === 'picking' ? summary.pending : params.get('dispatchView') === 'signing' ? summary.signing : params.get('dispatchView') === 'unfinished' ? [...new Map([...summary.pending, ...summary.signing].map(row => [row.id, row])).values()] : allIssues;
  const today = new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10);
  const overdue = [...new Map([...summary.pending, ...summary.signing].map(row => [row.id, row])).values()].filter(row => row.neededDate && row.neededDate < today);
  const issues = source.filter(issue => (!params.get('taskId') || issue.taskId === params.get('taskId')) && (params.get('dispatchView') !== 'reconcile' || issue.history.some(event => event.action === 'issue')) && (!params.has('overdue') || (!!issue.neededDate && issue.neededDate < today)) &&
    (status === 'all' || issue.status === status) && warehouseSearch(search, [issue.title, issue.taskId, issue.productLine, issue.recipientName, ...issue.lines.flatMap(line => [line.code, line.name])]),
  );
  const page = warehousePage<WarehouseIssue>(issues, params.get('dispatchPage') ?? params.get('issuePage'));
  const selectedId = params.get('dispatch') ?? params.get('issue');
  // Keep the selected task visible after its final issue has been issued.
  const selected = selectedId ? allIssues.find(issue => issue.id === selectedId) : page.rows[0];
  const change = (patch: Record<string, string | null>) => setParams(previous => warehouseQuery(previous, patch));
  const clearRecord = { issue: null, issueQ: null, issuePage: null, issueStatus: null, relatedReturns: null, returnStatus: null, returnDate: null, returnType: null, receipt: null, record: null, recordQ: null, recordKind: null, recordStatus: null, recordCheck: null, recordPage: null, warehouseView: null };
  const refresh = () => setVersion(value => value + 1);
  const selectIssue = (id: string) => change({ ...clearRecord, workbenchTab: tab, dispatch: id });
  const switchView = (value: string, patch: Record<string, string | null> = {}) => change({ ...clearRecord, taskId: null, issueDetails: null, workbenchTab: value, returnTask: null, recordMode: null, dispatchView: null, overdue: null, dispatch: null, dispatchQ: null, dispatchStatus: null, dispatchPage: null, ...patch });
  const metrics = [
    { title: '待配料', count: summary.pending.length, state: flows, view: 'picking', patch: {} },
    { title: '待签收', count: summary.signing.length, state: flows, view: 'issues', patch: { dispatchView: 'signing' } },
    { title: '待入库批次', count: records.data?.receipts.length ?? 0, state: records, view: 'receipts', patch: {} },
    { title: '待接收退料', count: records.data?.records.filter(row => row.kind === 'return' && row.status === 'pending').length ?? 0, state: records, view: 'returns', patch: { returnStatus: 'pending' } },
  ];
  const canIssue = !!selected && flows.data?.canIssue && !['cancelled', 'signed'].includes(selected.status) && selected.lines.some(line => line.quantity > (line.issuedQty ?? 0));
  const canSign = !!selected && selected.recipientId === user?.id && selected.status !== 'cancelled' && selected.lines.some(line => (line.issuedQty ?? 0) > (line.signedQty ?? 0));
  const headers = (labels: string[]) => <TableHeader><TableRow>{labels.map(label => <TableHead key={label} scope="col">{t(label)}</TableHead>)}</TableRow></TableHeader>;
  const noAccess = <OrderEmptyState Icon={Warehouse} title={t('暂无此项数据的查看权限')} description={t('请联系管理员开通对应业务的查看权限。')} />;
  const flowState = !access.flows ? noAccess : flows.loading ? <div role="status" aria-label={t('正在加载')} className="p-5"><Skeleton className="h-64 w-full motion-reduce:animate-none" /></div> : flows.error ? <div role="alert" className="p-5"><p className="text-sm text-destructive">{flows.error}</p><Button className="mt-3" variant="outline" onClick={refresh}>{t('重新加载')}</Button></div> : null;

  const pickingWorkspace = <div className="warehouse-cockpit-workspace">
    <section className="warehouse-surface warehouse-cockpit-dispatches" aria-label={t('按派工单配料')}>
      <div className="warehouse-cockpit-section-heading"><h2>{t(tab === 'picking' ? '按派工单配料' : '领料单')}</h2><ClipboardList className="size-5 text-primary" aria-hidden="true" /></div>
      <div className="warehouse-cockpit-filters"><Input aria-label={t('搜索派工领料单')} placeholder={t('搜索派工单、物料或领料人')} value={search} onChange={event => change({ dispatchQ: event.target.value, dispatchPage: null, dispatch: null, ...clearRecord })} />
        {tab === 'issues' && <NativeSelect aria-label={t('领料状态')} value={status} onChange={event => change({ dispatchStatus: event.target.value, dispatchPage: null, dispatch: null, ...clearRecord })}><option value="all">{t('全部状态')}</option>{Object.entries(WAREHOUSE_STATUS).map(([value, label]) => <option key={value} value={value}>{t(label)}</option>)}</NativeSelect>}
      </div>
      {issues.length ? <ul className="warehouse-cockpit-dispatch-list">{page.rows.map(issue => <li key={issue.id}><Button variant="unstyled" type="button" aria-pressed={selected?.id === issue.id} className="warehouse-cockpit-dispatch" onClick={() => selectIssue(issue.id)}>
        <span className="warehouse-cockpit-dispatch-title">{issue.title}</span><span className="warehouse-cockpit-status">{t(WAREHOUSE_STATUS[issue.status])}</span>
        <span className="warehouse-cockpit-dispatch-meta">{issue.productLine || '—'} · {issue.neededDate || t('需求日期待确认')}</span>
        <span className="warehouse-cockpit-dispatch-meta">{t('{count} 项物料', { count: issue.lines.length })} · {issue.recipientName || t('领料人待确认')}</span>
      </Button></li>)}</ul> : <OrderEmptyState Icon={PackageCheck} title={t(search || status !== 'all' ? '没有匹配的领料记录' : tab === 'picking' ? '当前没有待配料派工单' : '暂无可见的生产领料需求')} description={t('生产派工确认后，领料需求会显示在这里。')} action={(search || status !== 'all') ? <Button variant="outline" onClick={() => change({ dispatchQ: null, dispatchStatus: null, dispatchPage: null, dispatch: null, ...clearRecord })}>{t('清除筛选')}</Button> : undefined} />}
      <WarehousePagination {...page} onPage={value => change({ dispatchPage: String(value), dispatch: null, ...clearRecord })} />
    </section>
    <section className="warehouse-surface warehouse-cockpit-order" aria-label={t('配料领料与退料办理')}>
      {!selected ? <OrderEmptyState Icon={ClipboardList} title={t(selectedId ? '未找到这张领料单' : '请选择派工单')} description={t('领料明细和生产退料将在同一操作区展示。')} /> : <>
        <header className="warehouse-cockpit-order-heading"><div><p>{selected.productLine || '—'} · {t('需求日')} {selected.neededDate || t('待确认')}</p><h2>{selected.title}</h2><p>{t('领料人')}：{selected.recipientName || '—'} · {t(WAREHOUSE_STATUS[selected.status])}</p></div><div className="warehouse-cockpit-actions">
          {canIssue && <Button onClick={() => { selectIssue(selected.id); setEditor({ issue: selected, action: 'issue' }); }}>{t('登记发料')}</Button>}
          {canSign && <Button variant={canIssue ? 'outline' : 'default'} onClick={() => { selectIssue(selected.id); setEditor({ issue: selected, action: 'sign' }); }}>{t('确认签收')}</Button>}
          <Button variant="outline" aria-expanded={params.has('issueDetails')} onClick={() => change({ workbenchTab: tab, dispatch: selected.id, issueDetails: params.has('issueDetails') ? null : '1' })}>{t('原单记录与凭证')}<ChevronDown className="size-4" aria-hidden="true" /></Button>
        </div></header>
        <div className="warehouse-cockpit-materials"><div className="warehouse-cockpit-section-heading"><h3>{t('领料明细')}</h3><span>{t('{count} 项物料', { count: selected.lines.length })}</span></div>
          <Table className="min-w-[580px]" aria-label={t('领料明细')}>{headers(['物料 / 编码', '需求', '已发', '待发', '已签收'])}<TableBody>{selected.lines.map(line => <TableRow key={line.code}>
            <TableCell><p className="font-medium">{line.name}</p><p className="mt-1 text-xs text-muted-foreground">{line.code} · {line.unit}</p></TableCell>
            <TableCell className="tabular-nums">{number(line.quantity)}</TableCell><TableCell className="tabular-nums">{number(line.issuedQty ?? 0)}</TableCell>
            <TableCell className={`tabular-nums font-semibold${line.quantity > (line.issuedQty ?? 0) ? ' text-amber-700 dark:text-amber-400' : ''}`}>{number(Math.max(0, line.quantity - (line.issuedQty ?? 0)))}</TableCell><TableCell className="tabular-nums">{number(line.signedQty ?? 0)}</TableCell>
          </TableRow>)}</TableBody></Table>
        </div>
        {params.has('issueDetails') && <section className="warehouse-cockpit-returns" aria-label={t('原单记录与凭证')}><h3 className="mb-3 text-sm font-semibold">{t('办理记录')}</h3>{!selected.history.length ? <p className="text-sm text-muted-foreground">{t('暂无记录')}</p> : <ol className="space-y-3">{[...selected.history].reverse().map(event => {
          const checked = latestWarehouseCheck(selected, event.id)?.reconciliation, result = checked?.result;
          return <li key={event.id} className="flex flex-wrap items-start justify-between gap-3 border-b border-border pb-3 last:border-0"><div className="min-w-0">
            <p className="text-xs text-muted-foreground">{event.actorName} · {new Date(event.at).toLocaleString()} · {t(event.reconciliation ? WAREHOUSE_CHECK_STATUS[event.reconciliation.result] : event.action === 'issue' ? '发料登记' : event.action === 'sign' ? '现场签收' : '生产派工')}</p>
            <p className="mt-1 whitespace-pre-wrap break-words text-sm">{event.reason}</p>
            {event.reconciliation && <div className="mt-2 space-y-1 text-xs text-muted-foreground">
              <p>{t('人工核对')} · {event.reconciliation.voucherNumber ?? t('撤回核对')}{event.reconciliation.posted === false && ` · ${t('凭证未生效')}`}{event.reconciliation.detailsMatch === false && ` · ${t('物料、仓库或单位不一致')}`}</p>
              {event.reconciliation.lines.map(line => <p key={line.code} className="tabular-nums">{line.code} · {t('凭证行')} {line.voucherLine} · {t('本次对应')} {number(line.quantity)} / {t('凭证行总量')} {number(line.voucherQuantity)}</p>)}
            </div>}
            {event.lines?.map(line => <p key={line.code} className="mt-1 text-xs">{line.code} · {number(line.quantity)} {selected.lines.find(row => row.code === line.code)?.unit}{line.warehouse && ` · ${line.warehouse}`}</p>)}
            {event.action === 'issue' && <p className="mt-1 text-xs text-muted-foreground">{t(result ? WAREHOUSE_CHECK_STATUS[result] : 'T+ 待核对')}{checked?.voucherNumber && ` · ${checked.voucherNumber}`}</p>}
          </div>{event.action === 'issue' && flows.data?.canReconcile && <Button size="sm" variant="outline" onClick={() => setCheckEditor({ issue: selected, event, revoke: result === 'matched' })}>{t(result === 'matched' ? '撤回核对' : result === 'difference' ? '处理差异' : '核对凭证')}</Button>}</li>;
        })}</ol>}<p className="mt-3 text-xs text-muted-foreground">{t('人工核对不代表 ERP 已同步。')}</p></section>}
        <section className="warehouse-cockpit-returns warehouse-inline-returns"><Button variant="ghost" className="w-full justify-between" aria-expanded={params.has('relatedReturns')} onClick={() => change({ ...clearRecord, workbenchTab: tab, dispatch: selected.id, relatedReturns: params.has('relatedReturns') ? null : '1' })}>{t('关联生产退料')}<ChevronDown className="size-4" aria-hidden="true" /></Button>
          {params.has('relatedReturns') && <WarehouseRecordsPanel key={selected.taskId} issues={[selected]} reload={version} onSaved={refresh} scope={{ kind: 'return', taskId: selected.taskId }} returnWorkspace />}
        </section>
      </>}
    </section>
  </div>;

  return <main className="horizon-theme order-horizon warehouse-cockpit mx-auto flex w-full min-w-0 max-w-[1600px] flex-col gap-3 pb-5 warehouse-workbench">
    <OrderPageHeader Icon={Warehouse} eyebrow={t('订单与库存')} title={t('仓库工作台')} actions={<>
      {hasPermission(user?.permissions ?? [], 'page:production-execution') && <Button asChild variant="outline"><Link to={subRoutePath('page:warehouse-flow', '/warehouse-flow', 'shipments')}>{t('实际出货记录')}</Link></Button>}
      {access.startCount && <Button asChild><Link to={routePath('page:warehouse-count', '/warehouse-count') + '?new=1'}>{t('发起盘点')}</Link></Button>}
      {access.counts && <Button asChild variant="outline"><Link to={routePath('page:warehouse-count', '/warehouse-count')}>{t('库存盘点')}</Link></Button>}
      {access.inventory && <Button asChild variant="outline"><Link to={routePath('page:inventory-management', '/inventory-management')}>{t('库存管理')}</Link></Button>}
      <Button variant="outline" disabled={flows.loading || records.loading} onClick={refresh}><RefreshCw className="size-4" aria-hidden="true" />{t('刷新')}</Button>
    </>} />
    {access.flows && <section className="warehouse-workbench-summary" aria-label={t('仓库待办汇总')}>
      {metrics.map(metric => <Button variant="unstyled" key={metric.title} type="button" className="warehouse-workbench-metric" aria-label={t(metric.title)} aria-pressed={!params.has('overdue') && tab === metric.view && (metric.view !== 'issues' || params.get('dispatchView') === 'signing')} onClick={() => switchView(metric.view, metric.patch)}><span>{t(metric.title)}</span><strong>{metric.state.loading ? '…' : metric.state.error || !metric.state.data ? t('未读取') : number(metric.count)}</strong><small>{t(metric.view === 'receipts' ? '批' : '单')}</small></Button>)}
      <Button variant="unstyled" type="button" className="warehouse-workbench-metric warehouse-workbench-overdue" aria-label={t('逾期提醒')} aria-pressed={params.has('overdue')} title={t('仅统计尚未完成配料或签收、且已过需求日的派工单；同一单只计一次。')} onClick={() => switchView('issues', { overdue: '1', dispatchView: 'unfinished' })}><span><AlertTriangle className="size-4" aria-hidden="true" />{t('已过需求日')}</span><strong>{flows.loading ? '…' : flows.error || !flows.data ? t('未读取') : overdue.length}</strong><small>{t('单')}</small></Button>
    </section>}
    {records.error && <p role="alert" className="text-sm text-destructive">{records.error}</p>}
    <Tabs value={tab} onValueChange={value => switchView(value)}>
      <div className="warehouse-workbench-nav"><div className="warehouse-cockpit-tabs"><TabsList aria-label={t('仓库业务分类')}>{Object.entries(tabs).map(([value, label]) => <TabsTrigger key={value} value={value}>{t(label)}</TabsTrigger>)}</TabsList></div>
        <DropdownMenu><DropdownMenuTrigger asChild><Button variant={tab === 'records' ? 'default' : 'outline'}>{t('更多操作')}<ChevronDown className="size-4" aria-hidden="true" /></Button></DropdownMenuTrigger><DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={() => switchView('records', { recordMode: 'other' })}>{t('冻结与报废')}</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => switchView('records', { recordMode: 'reconcile', recordCheck: 'pending' })}>{t('库存凭证核对')}</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => switchView('issues', { dispatchView: 'reconcile', issueDetails: '1' })}>{t('领料凭证核对')}</DropdownMenuItem>
        </DropdownMenuContent></DropdownMenu>
      </div>
      {(params.has('overdue') || params.get('dispatchView') === 'signing' || params.get('dispatchView') === 'reconcile' || params.has('taskId')) && <div className="warehouse-active-filter"><span>{t(params.has('overdue') ? '仅看已过需求日的未完成单' : params.get('dispatchView') === 'signing' ? '仅看待签收' : params.get('dispatchView') === 'reconcile' ? '领料凭证核对' : '当前派工')}{params.get('taskId') && ' · ' + params.get('taskId')}</span><Button variant="ghost" size="sm" onClick={() => switchView(tab)}>{t('清除筛选')}</Button></div>}
      {(tab === 'picking' || tab === 'issues') && <TabsContent value={tab}>{flowState ?? pickingWorkspace}</TabsContent>}
      {tab === 'receipts' && <TabsContent value="receipts">{access.flows ? <WarehouseRecordsPanel key="receipts" issues={[]} reload={version} onSaved={refresh} scope={{ kind: 'receipt' }} /> : noAccess}</TabsContent>}
      {tab === 'returns' && <TabsContent value="returns">{!access.flows ? noAccess : <>{flows.error && <p role="alert" className="mb-3 text-sm text-destructive">{t('领料来源读取失败，可查看退料单；刷新后可恢复发起退料。')}</p>}<WarehouseRecordsPanel key={`returns:${params.get('returnTask') || 'all'}`} issues={allIssues} reload={version} onSaved={refresh} scope={{ kind: 'return', taskId: params.get('returnTask') || undefined }} returnWorkspace /></>}</TabsContent>}
      {tab === 'records' && <TabsContent value="records">{access.flows ? <WarehouseRecordsPanel key={params.get('recordMode') || 'legacy'} issues={allIssues} reload={version} onSaved={refresh} mode={params.get('recordMode') === 'reconcile' ? 'reconcile' : params.get('recordMode') === 'other' ? 'other' : undefined} /> : noAccess}</TabsContent>}
    </Tabs>
    {checkEditor && <WarehouseReconcileEditor key={checkEditor.issue.id + ':' + checkEditor.event.id} {...checkEditor} onClose={() => setCheckEditor(null)} onSaved={() => { setCheckEditor(null); refresh(); }} />}
    {editor && flows.data && <WarehouseIssueEditor key={`${editor.issue.id}:${editor.action}`} {...editor} balances={flows.data.balances} onClose={() => setEditor(null)} onSaved={() => { setEditor(null); refresh(); }} />}
  </main>;
}
