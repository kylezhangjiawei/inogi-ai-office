import { useEffect, useState, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router';
import { ArrowUpRight, Box, CalendarDays, CheckCheck, ChevronLeft, ChevronRight, ClipboardList, Clock3, Info, Megaphone, RefreshCw, Users } from 'lucide-react';
import { ManagementRiskPanel } from '../../dashboard/ManagementRiskPanel';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { NativeSelect } from '../../components/ui/native-select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../../components/ui/table';
import { Tooltip, TooltipContent, TooltipTrigger } from '../../components/ui/tooltip';
import { useAuth } from '../../auth';
import { usePermission } from '../../hooks/usePermission';
import { routePath } from '../../lib/routePaths';
import { authFetch, readErrorMessage } from '../../lib/authSession';
import { ProductionEmpty, ProductionPagination } from './ProductionView';
import { productionPage, productionQuery } from './productionViewState';
import { ProductionDashboardCharts, type DashboardStatistics } from './ProductionDashboardCharts';
import './production-dashboard.css';
import './production-theme.css';

interface Overview {
  month: string; scope: 'all' | 'assigned'; targetQty: number | null; shipmentTargetQty: number | null; actualShippedQty: number | null;
  dashboard?: DashboardStatistics;
  tasks: { id: string; planId: string; month: string; productLine: string; batchCode: string; name: string; line: string; ownerId: string; ownerName: string; status: string; quantity: number; goodQty: number; reportedQty: number; output: string; unit: string; date: string }[];
  shipments: { id: string; quantity: number; date: string; voucher: string; recipient: string }[];
}
const format = (value: number) => value.toLocaleString('zh-CN', { maximumFractionDigits: 3 });
const today = () => new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10);

function DashboardInfo({ label, children }: { label: string; children: ReactNode }) {
  return <Tooltip><TooltipTrigger asChild><Button type="button" variant="unstyled" className="cockpit-info" aria-label={label + '统计说明'}><Info size={14} aria-hidden="true" /></Button></TooltipTrigger><TooltipContent>{children}</TooltipContent></Tooltip>;
}
export function ProductionDashboardPage() {
  const { user } = useAuth();
  return <ProductionDashboardContent key={user?.id + ':' + user?.permissions?.join(',')} />;
}
function ProductionDashboardContent() {
  const { user } = useAuth(), canExecute = usePermission('page:production-execution');
  const [params, setParams] = useSearchParams();
  const month = /^\d{4}-(0[1-9]|1[0-2])$/.test(params.get('month') || '') ? params.get('month')! : today().slice(0, 7);
  const [stored, setStored] = useState<{ key: string; value: Overview } | null>(null), [error, setError] = useState(''), [reload, setReload] = useState(0);
  const actorKey = user?.id + ':' + user?.permissions?.join(',');
  const key = month + ':' + actorKey + ':' + reload, data = stored?.key === key ? stored.value : null;
  const model = params.get('model') || 'all', range = params.get('lineRange') || (month === today().slice(0, 7) ? 'today' : 'all');
  useEffect(() => {
    const controller = new AbortController(); setError(''); setStored(null);
    authFetch('/api/procurement/production-execution/overview?' + new URLSearchParams({ month }), { signal: controller.signal })
      .then(async response => { if (!response.ok) throw new Error(await readErrorMessage(response, '生产总览读取失败')); return response.json(); })
      .then(value => { if (!controller.signal.aborted) setStored({ key, value }); })
      .catch(cause => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : '生产总览读取失败'); });
    return () => controller.abort();
  }, [month, reload, actorKey]);
  function filter(field: string, value: string | null) { setParams(previous => productionQuery(previous, { [field]: value, page: null, ...(field === 'month' ? { shipmentPage: null, lineRange: null } : {}) }), { replace: true }); }
  function moveMonth(offset: number) { const [year, number] = month.split('-').map(Number); filter('month', new Date(Date.UTC(year, number - 1 + offset, 1)).toISOString().slice(0, 7)); }
  const activeTasks = data?.tasks.filter(task => task.status !== 'cancelled') ?? [];
  const tasks = activeTasks.filter(task => (model === 'all' || task.productLine === model) && (range !== 'today' || task.date === today()));
  const page = productionPage(tasks, params.get('page'), 3), shipments = productionPage(data?.shipments ?? [], params.get('shipmentPage'));
  const executionPath = routePath('page:production-execution', '/production-execution');
  const workHref = (view: string) => executionPath + '?' + new URLSearchParams({ month, view });
  const models = [...new Set(activeTasks.map(task => task.productLine))].filter(Boolean).sort();
  const unavailable = data?.scope === 'assigned' ? '超出当前授权范围' : '等待最终闸门数据';
  const shipped = data?.actualShippedQty, shipmentTarget = data?.shipmentTargetQty;
  return <main className="production-page production-dashboard production-ui-theme">
    <header className="cockpit-heading"><div><p className="cockpit-breadcrumb">生产管理 / 总览</p><h1>生产驾驶舱</h1><p>掌握生产计划、产线进度与质量异常，跟进交付。</p></div><div className="cockpit-header-actions"><time dateTime={today()}><CalendarDays size={16} aria-hidden="true" />{today().replaceAll('-', '/')}</time><Button size="sm" variant="outline" onClick={() => setReload(value => value + 1)}><RefreshCw size={15} aria-hidden="true" />刷新</Button>{canExecute && <Button size="sm" asChild><Link to={workHref('batches')}>生产计划与派工<ArrowUpRight size={15} aria-hidden="true" /></Link></Button>}</div></header>

    <section className="cockpit-notice" aria-label="生产执行提醒"><Megaphone size={19} aria-hidden="true" /><strong>生产执行提醒</strong><span>报工、终检合格、最终闸门与 QA 放行分别记录</span>{canExecute && <Link to={workHref('transfer')}>查看适用 ECN<ChevronRight size={14} aria-hidden="true" /></Link>}</section>

    <section className="cockpit-monthbar" aria-label="月度生产概况"><div className="cockpit-month-control"><Button size="icon" variant="ghost" aria-label="上个月" onClick={() => moveMonth(-1)}><ChevronLeft size={16} /></Button><Input type="month" aria-label="统计月份" value={month} onChange={event => { if (event.target.value) filter('month', event.target.value); }} /><Button size="icon" variant="ghost" aria-label="下个月" onClick={() => moveMonth(1)}><ChevronRight size={16} /></Button></div><div className="cockpit-shipment"><span>月度发货目标 <strong>{shipmentTarget == null ? '—' : format(shipmentTarget)}</strong> 台</span><span>实际净发货 <strong className="cockpit-green">{shipped == null ? '—' : format(shipped)}</strong> 台</span><span>距发货目标 <strong>{shipped == null || shipmentTarget == null ? '—' : format(Math.max(0, shipmentTarget - shipped))}</strong> 台<DashboardInfo label="距发货目标">月度发货目标减去按实际发货日期统计的本月净发货，最低为零。包含往月计划本月发货；不代表已完工待出货库存。</DashboardInfo></span></div><Button variant="ghost" size="sm" disabled={month === today().slice(0, 7)} onClick={() => filter('month', today().slice(0, 7))}>回到本月</Button></section>
    {error && <div className="production-inline-error cockpit-card" role="alert"><p>{error}</p><Button variant="outline" onClick={() => setReload(value => value + 1)}>重新加载</Button></div>}
    {!error && !data && <p className="cockpit-loading" role="status">正在汇总正式生产数据…</p>}
    {data?.scope === 'assigned' && <p className="production-note" role="status">当前仅统计本人获派作业，整体生产与发货指标不在当前权限范围。</p>}

    <section className="cockpit-kpis" aria-label="生产核心指标">
      <article className="cockpit-kpi"><span className="cockpit-kpi-icon"><ClipboardList size={25} aria-hidden="true" /></span><div><h2>本月整机计划<DashboardInfo label="本月整机计划">所选月份正式月度计划的整机目标合计，不累计组件派工数量。</DashboardInfo></h2><p className="cockpit-number">{data?.targetQty == null ? '—' : format(data.targetQty)}<small>台</small></p><p className="cockpit-kpi-note">{data?.scope === 'assigned' ? '超出当前授权范围' : '按月度计划统计'}</p></div></article>
      <article className="cockpit-kpi" data-tone="green"><span className="cockpit-kpi-icon"><CheckCheck size={25} aria-hidden="true" /></span><div><h2>本月整机完工<DashboardInfo label="本月整机完工">性能检验及最终闸门通过才算整机完工，按闸门通过日期统计，包含往月生产单本月完工；QA 放行另记。当前尚未建立闸门数据关联，不能以报工或普通终检代替。</DashboardInfo></h2><p className="cockpit-number">—<small>台</small></p><p className="cockpit-kpi-note">{unavailable}</p></div></article>
      <article className="cockpit-kpi" data-tone="orange"><span className="cockpit-kpi-icon"><Clock3 size={25} aria-hidden="true" /></span><div><h2>计划剩余整机<DashboardInfo label="计划剩余整机">本月计划目标减去归属本月计划、已过最终闸门的数量。与按完工日期统计的月度完工是两个口径；闸门数据未接入前不计算。</DashboardInfo></h2><p className="cockpit-number">—<small>台</small></p><p className="cockpit-kpi-note">本月计划完成率 <strong>—</strong></p></div></article>
      <article className="cockpit-kpi" data-tone="violet"><span className="cockpit-kpi-icon"><Users size={25} aria-hidden="true" /></span><div><h2>今日在岗<DashboardInfo label="今日在岗">需接入生产产线与质检人员的实际考勤或签到数据。获派任务人数不能作为在岗人数，当前不展示估算值。</DashboardInfo></h2><p className="cockpit-number">—<small>人</small></p><p className="cockpit-kpi-note">考勤数据待接入</p></div></article>
    </section>

    <ProductionDashboardCharts statistics={data?.dashboard} month={month} loading={!data && !error} error={Boolean(error)} />

    <div className="cockpit-bottom-grid">
      <section className="cockpit-card cockpit-lines" aria-label="现场作业列表"><div className="cockpit-section-title"><h2><Box size={18} aria-hidden="true" />{range === 'today' ? '产线今日任务' : '产线任务进度'}</h2>{canExecute && <Link to={workHref('tasks')}>全部任务<ChevronRight size={14} aria-hidden="true" /></Link>}</div><div className="cockpit-line-filters"><NativeSelect aria-label="产线任务范围" value={range} onChange={event => filter('lineRange', event.target.value)}><option value="today">今日排定</option><option value="all">本月与跨月未完</option></NativeSelect><NativeSelect aria-label="作业型号" value={model} onChange={event => filter('model', event.target.value === 'all' ? null : event.target.value)}><option value="all">全部型号</option>{models.map(value => <option key={value}>{value}</option>)}</NativeSelect></div>
        {error ? <ProductionEmpty title="产线任务暂时不可用" description="请重新加载生产数据。" /> : !data ? <p className="cockpit-loading" role="status">正在读取产线任务…</p> : !tasks.length ? <ProductionEmpty title={range === 'today' ? '今日暂无排定任务' : '当前范围暂无任务'} description="可切换范围，或进入生产计划与派工查看计划。" /> : <ul className="cockpit-line-list">{page.rows.map(task => {
          const percent = task.quantity ? Math.min(100, task.reportedQty / task.quantity * 100) : 0;
          const href = executionPath + '?' + new URLSearchParams({ month, plan: task.planId, view: 'tasks', task: task.id });
          return <li key={task.id}><div className="cockpit-line-heading"><span className="cockpit-line-icon"><Box size={19} aria-hidden="true" /></span><div><h3>{canExecute ? <Link to={href}>{task.line || '产线待确认'} · {task.name}</Link> : (task.line || '产线待确认') + ' · ' + task.name}</h3><p>{task.productLine} · {task.batchCode} · {task.ownerName || '负责人待确认'}</p></div><span className="cockpit-line-percent">{percent.toFixed(1)}<small>%</small></span></div><div className="cockpit-line-progress"><progress aria-label={task.name + '报工进度'} value={task.reportedQty} max={Math.max(task.quantity, 1)} /><div><span>已报工 {format(task.reportedQty)} / {format(task.quantity)} {task.unit}</span><span>{task.status === 'draft' ? '待派工' : '报工良品 ' + format(task.goodQty) + ' ' + task.unit}</span></div></div></li>;
        })}</ul>}
        {data && <ProductionPagination {...page} onPageChange={value => setParams(previous => productionQuery(previous, { page: String(value) }))} />}
      </section>
      <ManagementRiskPanel month={month} presentation="production" refreshKey={reload} />
    </div>

    <footer className="cockpit-footer"><span><Info size={14} aria-hidden="true" />“—”表示未接入或无权查看，不表示零。组件数量不累计为整机数量。</span><nav aria-label="生产快捷入口">{canExecute && <><Link to={workHref('schedule')}>查看计划</Link><Link to={workHref('quality')}>不良处理</Link><Link to={workHref('archive')}>批次档案</Link></>}<Link to="/production-dashboard?view=legacy">其他协同任务</Link></nav></footer>
    {data?.scope === 'all' && <details className="cockpit-card cockpit-shipment-history"><summary className="production-disclosure">本月发货记录 <span>{data.shipments.length} 笔</span></summary>{!data.shipments.length ? <ProductionEmpty title="本月暂无实际发货记录" /> : <Table className="production-table"><TableHeader><TableRow>{['实际发货日', '发货凭证', '收货客户', '数量'].map(label => <TableHead key={label}>{label}</TableHead>)}</TableRow></TableHeader><TableBody>{shipments.rows.map(row => <TableRow key={row.id}><TableCell>{row.date}</TableCell><TableCell>{row.voucher}</TableCell><TableCell>{row.recipient}</TableCell><TableCell>{format(row.quantity)} 台</TableCell></TableRow>)}</TableBody></Table>}<ProductionPagination {...shipments} onPageChange={value => setParams(previous => productionQuery(previous, { shipmentPage: String(value) }))} /></details>}
  </main>;
}
