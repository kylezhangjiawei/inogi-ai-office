import { ManagementRiskPanel } from '../../dashboard/ManagementRiskPanel';
import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { ArrowUpRight, ClipboardList, RefreshCw } from 'lucide-react';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { NativeSelect } from '../../components/ui/native-select';
import { Checkbox } from '../../components/ui/checkbox';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../../components/ui/table';
import { HorizonPageHeader } from '../../components/horizon/HorizonPage';
import { useAuth } from '../../auth';
import { usePermission } from '../../hooks/usePermission';
import { routePath } from '../../lib/routePaths';
import { authFetch, readErrorMessage } from '../../lib/authSession';
import { ProductionEmpty, ProductionMetrics, ProductionPagination, ProductionStatus } from './ProductionView';
import { productionPage, productionQuery, productionSearch } from './productionViewState';

interface Overview { month: string; scope: 'all' | 'assigned'; targetQty: number | null; shipmentTargetQty: number | null; actualShippedQty: number | null; tasks: { id: string; planId: string; month: string; productLine: string; batchCode: string; name: string; ownerId: string; ownerName: string; status: string; quantity: number; goodQty: number; reportedQty: number; output: string; unit: string; date: string }[]; shipments: { id: string; quantity: number; date: string; voucher: string; recipient: string }[] }
const format = (value: number) => value.toLocaleString('zh-CN', { maximumFractionDigits: 3 });

export function ProductionDashboardPage() {
  const { user } = useAuth();
  return <ProductionDashboardContent key={`${user?.id ?? ''}:${user?.permissions?.join(',') ?? ''}`} />;
}

function ProductionDashboardContent() {
  const { user } = useAuth(), canExecute = usePermission('page:production-execution');
  const [params, setParams] = useSearchParams();
  const month = /^\d{4}-(0[1-9]|1[0-2])$/.test(params.get('month') || '') ? params.get('month')! : new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 7);
  const [data, setData] = useState<Overview | null>(null), [error, setError] = useState(''), [reload, setReload] = useState(0);
  const search = params.get('q') || '', mine = params.get('mine') === '1', status = params.get('status') || 'all';
  const actorKey = `${user?.id ?? ''}:${user?.permissions?.join(',') ?? ''}`;
  useEffect(() => {
    const controller = new AbortController(); setError(''); setData(null);
    authFetch(`/api/procurement/production-execution/overview?${new URLSearchParams({ month })}`, { signal: controller.signal }).then(async response => { if (!response.ok) throw new Error(await readErrorMessage(response, '生产总览读取失败')); return response.json(); }).then(value => { if (!controller.signal.aborted) setData(value); }).catch(cause => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : '生产总览读取失败'); });
    return () => controller.abort();
  }, [month, reload, actorKey]);
  function filter(key: string, value: string | null) { setParams(previous => productionQuery(previous, { [key]: value, page: null, ...(key === 'month' ? { shipmentPage: null } : {}) }), { replace: true }); }
  const tasks = data?.tasks.filter(task => {
    const matchesStatus = status === 'all' || (status === 'carryover' ? task.month < month : status === 'unreported' ? task.status === 'dispatched' && task.reportedQty < task.quantity : task.status === status);
    return (!mine || task.ownerId === user?.id) && matchesStatus && productionSearch(search, [task.name, task.ownerName, task.productLine, task.batchCode]);
  }) ?? [];
  const page = productionPage(tasks, params.get('page'));
  const shipments = productionPage(data?.shipments ?? [], params.get('shipmentPage'));
  return <main className="production-page">
    <HorizonPageHeader Icon={ClipboardList} eyebrow="质量与生产" title="生产驾驶舱" actions={<><Button variant="outline" asChild><Link to="/production-dashboard?view=legacy">其他协同任务</Link></Button>{canExecute && <Button asChild><Link to={`${routePath('page:production-execution', '/production-execution')}?${new URLSearchParams({ month })}`}>生产计划</Link></Button>}<Button variant="outline" onClick={() => setReload(value => value + 1)}><RefreshCw className="size-4" aria-hidden="true" />刷新</Button></>} />
    <div className="flex flex-wrap items-center gap-3"><label className="flex items-center gap-2 text-sm text-muted-foreground">统计月份<Input className="w-44" type="month" value={month} onChange={event => { if (event.target.value) filter('month', event.target.value); }} /></label><p className="production-note">{data?.scope === 'assigned' ? '仅展示授权作业；计划整体指标不在当前权限范围。' : '以下目标与净发货为本月整体口径；列表筛选仅作用于现场作业。'}</p></div>
    {error ? <section className="production-surface p-5" role="alert"><p className="text-sm text-destructive">{error}</p><Button className="mt-3" variant="outline" onClick={() => setReload(value => value + 1)}>重新加载</Button></section> : !data ? <p role="status" className="p-6 text-sm text-muted-foreground">正在汇总正式业务…</p> : <>
      <ProductionMetrics items={[{ label: '本月生产目标', value: data.targetQty === null ? '—' : `${format(data.targetQty)} 台` }, { label: '本月发货目标', value: data.shipmentTargetQty === null ? '—' : `${format(data.shipmentTargetQty)} 台` }, { label: '本月实际净发货', value: data.actualShippedQty === null ? '—' : `${format(data.actualShippedQty)} 台`, note: '按实际发货日期，包含往月计划在本月发货' }]} />
    </>}
    <ManagementRiskPanel month={month} />
    {!error && data && <>
      <details className="production-surface"><summary className="cursor-pointer p-4 font-semibold">现场作业列表</summary><section aria-labelledby="production-work-heading">
        <div className="production-section-heading"><div><h2 id="production-work-heading">现场作业</h2><p>查看负责人、进度与日期，进入原作业办理。跨月未完成作业继续保留。</p></div></div>
        <div className="production-toolbar"><Input aria-label="搜索现场作业" placeholder="搜索作业、批次、型号或负责人" value={search} onChange={event => filter('q', event.target.value)} /><NativeSelect aria-label="作业状态" value={status} onChange={event => filter('status', event.target.value)}><option value="all">全部作业</option><option value="draft">待派工</option><option value="unreported">待继续报工</option><option value="carryover">跨月未完</option><option value="cancelled">已取消</option></NativeSelect><label><Checkbox checked={mine} onCheckedChange={value => filter('mine', value === true ? '1' : null)} />仅看本人</label></div>
        {!tasks.length ? <ProductionEmpty title="当前范围没有现场作业" description="可调整搜索或筛选条件，也可在生产计划中查看批次安排。" /> : <Table className="production-table"><TableHeader><TableRow>{['作业 / 批次', '负责人 / 产出', '计划日期', '状态', '已报 / 目标', '报工良品', '下一步'].map(label => <TableHead key={label}>{label}</TableHead>)}</TableRow></TableHeader><TableBody>{page.rows.map(task => {
          const href = `${routePath('page:production-execution', '/production-execution')}?${new URLSearchParams({ month, plan: task.planId, view: 'tasks', task: task.id })}`;
          return <TableRow key={task.id}><TableCell className="production-cell-main">{canExecute ? <Link className="production-link" to={href}>{task.name}</Link> : <span className="font-medium">{task.name}</span>}<p className="production-meta">{task.productLine} · {task.batchCode}</p></TableCell><TableCell>{task.ownerName || '待确认'}<p className="production-meta">{task.output === 'whole' ? '整机' : '组件'} · {task.unit}</p></TableCell><TableCell>{task.date || '待确认'}{task.month < month && <p className="production-meta">{task.month} · 跨月未完</p>}</TableCell><TableCell><ProductionStatus tone={task.status === 'draft' ? 'warning' : 'neutral'}>{task.status === 'draft' ? '待派工' : task.status === 'cancelled' ? '已取消' : task.reportedQty >= task.quantity ? '报工已齐' : '执行中'}</ProductionStatus></TableCell><TableCell>{format(task.reportedQty)} / {format(task.quantity)} {task.unit}<p className="production-meta">{task.quantity > 0 ? `${(task.reportedQty / task.quantity * 100).toFixed(1)}%` : '—'}</p></TableCell><TableCell>{format(task.goodQty)} {task.unit}<p className="production-meta">待完成 {format(Math.max(0, task.quantity - task.goodQty))} {task.unit}</p></TableCell><TableCell>{canExecute ? <Button variant="outline" size="sm" asChild><Link to={href}>{task.status === 'draft' ? '查看派工' : '进入作业'}<ArrowUpRight className="size-3.5" aria-hidden="true" /></Link></Button> : <span className="text-xs text-muted-foreground">只读范围</span>}</TableCell></TableRow>;
        })}</TableBody></Table>}
        <ProductionPagination {...page} onPageChange={value => setParams(previous => productionQuery(previous, { page: String(value) }))} />
      </section></details>
      <p className="production-note">现场报工、报工良品与质量放行分别记录；组件数量不计入整机完成。</p>
      <details className="production-surface"><summary className="cursor-pointer px-4 py-3 text-sm font-semibold">本月发货记录 <span className="ml-2 font-normal text-muted-foreground">{data.shipments.length} 笔</span></summary>{!data.shipments.length ? <ProductionEmpty title="本月暂无实际发货记录" /> : <Table className="production-table"><TableHeader><TableRow>{['实际发货日', '发货凭证', '收货客户', '数量'].map(label => <TableHead key={label}>{label}</TableHead>)}</TableRow></TableHeader><TableBody>{shipments.rows.map(row => <TableRow key={row.id}><TableCell>{row.date}</TableCell><TableCell>{row.voucher}</TableCell><TableCell className="production-cell-main">{row.recipient}</TableCell><TableCell>{format(row.quantity)} 台</TableCell></TableRow>)}</TableBody></Table>}<ProductionPagination {...shipments} onPageChange={value => setParams(previous => productionQuery(previous, { shipmentPage: String(value) }))} /></details>
    </>}
  </main>;
}
