import { Link, useSearchParams } from 'react-router';
import { ArrowUpRight, ClipboardCheck, Search } from 'lucide-react';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { NativeSelect } from '../../components/ui/native-select';
import { useAuth } from '../../auth';
import type { ExecutionPlan } from '../../lib/productionExecutionApi';
import { ProductionEmpty, ProductionPagination, ProductionStatus } from './ProductionView';
import { productionPage, productionPendingInspection, productionQuery, productionSearch, productionTaskState } from './productionViewState';

const qty = (value: number) => value.toLocaleString('zh-CN', { maximumFractionDigits: 3 });

/** One queue over the already-authorized plans; links always retain the original plan/task IDs. */
export function ProductionWorkQueue({ plans, inspection = false }: { plans: ExecutionPlan[]; inspection?: boolean }) {
  const { user } = useAuth();
  const [params, setParams] = useSearchParams();
  const prefix = inspection ? 'inspectQueue' : 'workQueue';
  const search = params.get(`${prefix}Q`) ?? (!inspection ? params.get('taskQ') : '') ?? '', model = params.get(`${prefix}Model`) || 'all';
  const line = params.get(`${prefix}Line`) || 'all', scope = params.get(`${prefix}Scope`) || (params.get('taskStatus') ? 'all' : 'pending');
  const batchId = params.get('batch') || 'all', taskStatus = inspection ? 'all' : params.get('taskStatus') || 'all';
  const today = new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10);
  const all = plans.flatMap(plan => plan.tasks.map(task => ({ plan, task, state: productionTaskState(task), pending: productionPendingInspection(task) })));
  const models = [...new Set(plans.map(plan => plan.productLine))].filter(Boolean).sort();
  const lines = [...new Set(all.map(({ task }) => task.line))].filter(Boolean).sort();
  const eligible = all.filter(({ task, pending }) => inspection ? task.status === 'dispatched' && pending > 0 : true);
  const rows = eligible.filter(({ plan, task, state }) => (model === 'all' || model === plan.productLine) && (line === 'all' || line === task.line)
    && (batchId === 'all' || task.batchId === batchId) && (taskStatus === 'all' || state.key === taskStatus)
    && (scope === 'all' || (scope === 'mine' ? task.ownerId === user?.id : scope === 'today' ? task.date === today : !['cancelled', 'reported'].includes(state.key)))
    && productionSearch(search, [plan.productName, plan.productLine, task.name, task.line, task.ownerName, plan.batches.find(batch => batch.id === task.batchId)?.code]))
    .sort((a, b) => (a.task.date || '9999').localeCompare(b.task.date || '9999') || a.task.name.localeCompare(b.task.name));
  const page = productionPage(rows, params.get(`${prefix}Page`), 10);
  const filter = (key: string, value: string) => setParams(previous => productionQuery(previous, { [`${prefix}${key}`]: value === 'all' && key !== 'Scope' ? null : value, [`${prefix}Page`]: null, ...(key === 'Q' ? { taskQ: null } : {}) }), { replace: true });
  return <section className="production-surface production-work-queue" aria-label={inspection ? '待终检任务' : '现场任务队列'}>
    <div className="production-section-heading"><div><h2>{inspection ? '待终检任务' : '现场任务'}</h2><p>{inspection ? '已报工尚未完成终检的任务，包含往月未完成记录。过程检不扣减待终检数量。' : '跨计划查看现场工作，进入原任务完成报工、检验和异常处理。'}</p></div><span className="production-result-count">{rows.length} 项</span></div>
    <div className="production-toolbar">
      <div className="production-search-field"><Search className="size-4" aria-hidden="true" /><Input aria-label={inspection ? '搜索待检任务' : '搜索现场任务'} value={search} placeholder="搜索任务、生产单或负责人" onChange={event => filter('Q', event.target.value)} /></div>
      <NativeSelect aria-label="队列产品型号" value={model} onChange={event => filter('Model', event.target.value)}><option value="all">全部型号</option>{models.map(value => <option key={value} value={value}>{value}</option>)}</NativeSelect>
      <NativeSelect aria-label="队列产线" value={line} onChange={event => filter('Line', event.target.value)}><option value="all">全部产线</option>{lines.map(value => <option key={value} value={value}>{value}</option>)}</NativeSelect>
      <NativeSelect aria-label="队列生产单" value={batchId} onChange={event => setParams(previous => productionQuery(previous, { batch: event.target.value === 'all' ? null : event.target.value, [`${prefix}Page`]: null }), { replace: true })}><option value="all">全部生产单</option>{plans.flatMap(plan => plan.batches.map(batch => <option key={batch.id} value={batch.id}>{batch.code} · {plan.productLine}</option>))}</NativeSelect>
      {!inspection && <NativeSelect aria-label="任务范围" value={scope} onChange={event => filter('Scope', event.target.value)}><option value="pending">待办理</option><option value="today">今日安排</option><option value="mine">我的任务</option><option value="all">全部记录</option></NativeSelect>}
      {taskStatus !== 'all' && <Button variant="ghost" size="sm" onClick={() => setParams(previous => productionQuery(previous, { taskStatus: null, [`${prefix}Page`]: null }), { replace: true })}>清除作业状态筛选</Button>}
    </div>
    {!rows.length ? <ProductionEmpty title={inspection ? '当前范围没有待终检任务' : '当前范围没有现场任务'} description="可调整型号、产线或搜索条件；已完成和已取消的现场任务可在全部记录中查看。" /> : <ul className="production-work-list">{page.rows.map(({ plan, task, state, pending }) => {
      const reported = task.reports.reduce((sum, report) => sum + report.quantity, 0);
      const batch = plan.batches.find(row => row.id === task.batchId);
      const href = `?${productionQuery(params, { plan: plan.id, task: task.id, view: 'tasks', taskSection: inspection || state.key === 'quality' ? 'quality' : null, inspection: null, taskFrom: inspection ? 'inspections' : null, workbench: params.has('plan') ? null : inspection ? 'inspections' : 'tasks' })}`;
      const overdue = task.date && task.date < today && !['cancelled', 'reported'].includes(state.key);
      return <li key={`${plan.id}/${task.id}`} className="production-work-row">
        <div className="production-work-identity"><div className="production-work-title"><Link className="production-link" to={href}>{task.name}</Link><ProductionStatus tone={state.key === 'quality' || state.key === 'draft' ? 'warning' : 'neutral'}>{state.label}</ProductionStatus></div><p>{plan.productLine} · 生产单 {batch?.code || '待确认'}{plan.carryover ? ' · 跨月未完' : ''}</p><p>{task.line || '产线待确认'} · {task.ownerName || '负责人待确认'}</p></div>
        <div className="production-work-progress"><span>{inspection ? '待终检' : '报工进度'}</span><strong>{inspection ? qty(pending) : `${qty(reported)} / ${qty(task.quantity)}`} <small>{task.unit}</small></strong>{!inspection && <progress aria-label={`${task.name}报工进度`} value={reported} max={Math.max(task.quantity, 1)} />}</div>
        <div className="production-work-date"><span>计划日期</span><time dateTime={task.date || undefined}>{task.date || '待安排'}</time>{overdue && <span className="production-overdue">计划日已过</span>}</div>
        <Button asChild variant="outline" size="sm"><Link to={href}>{inspection ? <><ClipboardCheck className="size-4" aria-hidden="true" />进入检验</> : <>{state.next}<ArrowUpRight className="size-4" aria-hidden="true" /></>}</Link></Button>
      </li>;
    })}</ul>}
    <ProductionPagination {...page} onPageChange={value => setParams(previous => productionQuery(previous, { [`${prefix}Page`]: String(value) }))} />
  </section>;
}
