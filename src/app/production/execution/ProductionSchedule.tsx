import { Link, useSearchParams } from 'react-router';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { NativeSelect } from '../../components/ui/native-select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../../components/ui/table';
import type { ExecutionPlan, ExecutionTask } from '../../lib/productionExecutionApi';
import { ProductionEmpty, ProductionPagination, ProductionStatus } from './ProductionView';
import { productionPage, productionQuery, productionTaskState } from './productionViewState';

const DAY = 86_400_000;
const UNASSIGNED = '__unassigned__';
const qty = (value: number) => value.toLocaleString('zh-CN', { maximumFractionDigits: 3 });

function validDate(value: string | null): value is string {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const time = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === value;
}

function addDays(date: string, days: number) {
  const time = Math.max(Date.parse('0000-01-01T00:00:00Z'), Math.min(Date.parse('9999-12-31T00:00:00Z'), Date.parse(`${date}T00:00:00Z`) + days * DAY));
  return new Date(time).toISOString().slice(0, 10);
}

function ownerKey(task: ExecutionTask) {
  return task.ownerId || (task.ownerName ? `name:${task.ownerName}` : UNASSIGNED);
}

export function ProductionSchedule({ plan }: { plan: ExecutionPlan }) {
  const [params, setParams] = useSearchParams();
  const today = new Date(Date.now() + 8 * 3_600_000).toISOString().slice(0, 10);
  const defaultStart = plan.month === today.slice(0, 7) || !validDate(`${plan.month}-01`) ? today : `${plan.month}-01`;
  const rawStart = params.get('scheduleStart'), rawEnd = params.get('scheduleEnd');
  const start = validDate(rawStart) ? rawStart : defaultStart;
  const span = ['3', '10', 'custom'].includes(params.get('scheduleSpan') || '') ? params.get('scheduleSpan')! : '10';
  const maxEnd = addDays(start, 30);
  const requestedEnd = span === 'custom' && validDate(rawEnd) ? rawEnd : addDays(start, span === '3' ? 2 : 9);
  const end = requestedEnd < start ? start : requestedEnd > maxEnd ? maxEnd : requestedEnd;
  const dateCount = Math.round((Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / DAY) + 1;
  const dates = Array.from({ length: dateCount }, (_, index) => addDays(start, index));
  const line = params.get('scheduleLine') || 'all', owner = params.get('scheduleOwner') || 'all', batch = params.get('scheduleBatch') || 'all';
  const lines = [...new Set(plan.tasks.map(task => task.line || UNASSIGNED))].sort((a, b) => a.localeCompare(b, 'zh-CN'));
  const owners = new Map<string, string>();
  for (const task of plan.tasks) owners.set(ownerKey(task), task.ownerName || '负责人待确认');
  const ownerNames = [...owners.values()];
  const matchesScope = (task: ExecutionTask) => (line === 'all' || (task.line || UNASSIGNED) === line) && (owner === 'all' || ownerKey(task) === owner) && (batch === 'all' || task.batchId === batch);
  const tasks = plan.tasks.filter(task => matchesScope(task) && validDate(task.date) && task.date >= start && task.date <= end);
  const undated = plan.tasks.filter(task => matchesScope(task) && !validDate(task.date)).length;
  const rows = new Map<string, Map<string, ExecutionTask[]>>();
  for (const task of tasks) {
    const key = task.line || UNASSIGNED;
    if (!rows.has(key)) rows.set(key, new Map());
    const cells = rows.get(key)!;
    cells.set(task.date, [...(cells.get(task.date) || []), task]);
  }
  const page = productionPage([...rows.keys()].sort((a, b) => a.localeCompare(b, 'zh-CN')), params.get('schedulePage'), 8);
  const update = (changes: Record<string, string | null>) => setParams(previous => productionQuery(previous, { ...changes, schedulePage: null }), { replace: true });
  const moveStart = (value: string) => {
    if (!validDate(value)) return;
    update({ scheduleStart: value, ...(span === 'custom' ? { scheduleEnd: addDays(value, dateCount - 1) } : {}) });
  };
  const filter = (key: string, value: string) => update({ [key]: value === 'all' ? null : value });

  return <section className="production-surface production-schedule" aria-label="生产日程">
    <div className="production-section-heading"><div><h2>生产日程</h2><p>按计划日期查看产线 / 工位安排，点击作业进入详情。</p></div><div className="production-schedule-navigation"><Button size="sm" variant="outline" onClick={() => moveStart(addDays(start, -dateCount))}>上一段</Button><Button size="sm" variant="outline" onClick={() => moveStart(today)}>今天</Button><Button size="sm" variant="outline" onClick={() => moveStart(addDays(start, dateCount))}>下一段</Button></div></div>
    <div className="production-toolbar production-schedule-toolbar">
      <label>显示区间<NativeSelect aria-label="日程显示区间" value={span} onChange={event => update({ scheduleSpan: event.target.value, scheduleEnd: event.target.value === 'custom' ? end : null })}><option value="3">3 天</option><option value="10">10 天</option><option value="custom">自定义</option></NativeSelect></label>
      <label>开始日期<Input aria-label="日程开始日期" type="date" max="9999-12-31" value={start} onChange={event => moveStart(event.target.value)} /></label>
      {span === 'custom' && <label>结束日期<Input aria-label="日程结束日期" type="date" min={start} max={maxEnd} value={end} onChange={event => { const value = event.target.value; if (validDate(value)) update({ scheduleEnd: value < start ? start : value > maxEnd ? maxEnd : value }); }} /></label>}
      <NativeSelect aria-label="日程产线或工位" value={line} onChange={event => filter('scheduleLine', event.target.value)}><option value="all">全部产线 / 工位</option>{lines.map(value => <option key={value} value={value}>{value === UNASSIGNED ? '产线 / 工位待确认' : value}</option>)}</NativeSelect>
      <NativeSelect aria-label="日程负责人" value={owner} onChange={event => filter('scheduleOwner', event.target.value)}><option value="all">全部负责人</option>{[...owners].map(([id, name]) => <option key={id} value={id}>{name}{ownerNames.filter(value => value === name).length > 1 ? ` · ${id}` : ''}</option>)}</NativeSelect>
      <NativeSelect aria-label="日程批次" value={batch} onChange={event => filter('scheduleBatch', event.target.value)}><option value="all">全部批次</option>{plan.batches.map(value => <option key={value.id} value={value.id}>{value.code}</option>)}</NativeSelect>
    </div>
    <div className="production-schedule-summary" role="status"><span>{start} 至 {end} · {tasks.length} 项作业 · {rows.size} 条产线 / 工位</span><span>{span === 'custom' ? '自定义区间最多 31 天。' : ''}{undated > 0 ? ` ${undated} 项作业尚未填写计划日期。` : ''}</span></div>
    {span === 'custom' && requestedEnd !== end && <p className="production-schedule-notice" role="alert">日期区间已限制为开始日起最多 31 天，结束日期不能早于开始日期。</p>}
    {!tasks.length ? <ProductionEmpty title={plan.tasks.length ? '当前日程没有匹配的作业' : '还没有排期作业'} description={plan.tasks.length ? '调整日期、产线、负责人或批次筛选后重试。' : '在批次中编制作业并填写计划日期后，安排会显示在这里。'} /> : <Table className="production-schedule-table" containerClassName="production-schedule-scroll" aria-label="生产日程矩阵">
      <TableHeader><TableRow><TableHead scope="col" className="production-schedule-line">产线 / 工位</TableHead>{dates.map(date => <TableHead key={date} scope="col" className="production-schedule-date" data-today={date === today || undefined}><time dateTime={date}>{date.slice(5)}</time><span>{['周日', '周一', '周二', '周三', '周四', '周五', '周六'][new Date(`${date}T00:00:00Z`).getUTCDay()]}</span>{date === today && <span>今天</span>}</TableHead>)}</TableRow></TableHeader>
      <TableBody>{page.rows.map(row => <TableRow key={row}><TableHead scope="row" className="production-schedule-line">{row === UNASSIGNED ? '产线 / 工位待确认' : row}</TableHead>{dates.map(date => <TableCell key={date} className="production-schedule-cell">{rows.get(row)?.get(date)?.map(task => {
        const state = productionTaskState(task), batchName = plan.batches.find(value => value.id === task.batchId)?.code || '批次待确认';
        const href = `?${productionQuery(params, { plan: plan.id, view: 'tasks', task: task.id, taskFrom: 'schedule', taskSection: null, inspection: null, record: null, recordType: null })}`;
        return <Link key={task.id} className="production-schedule-task" data-cancelled={task.status === 'cancelled' || undefined} to={href} aria-label={`${task.name}，${date}，${row === UNASSIGNED ? '产线待确认' : row}，${state.label}`}><div className="production-schedule-task-heading"><strong>{task.name}</strong><ProductionStatus tone={['draft', 'quality', 'inspection'].includes(state.key) ? 'warning' : 'neutral'}>{state.label}</ProductionStatus></div><span>{batchName} · {task.ownerName || '负责人待确认'}</span><span className="production-schedule-quantity">计划 {qty(task.quantity)} {task.unit}</span>{task.status !== 'cancelled' && <span>已报 {qty(task.reports.reduce((sum, report) => sum + report.quantity, 0))} {task.unit}</span>}</Link>;
      }) || <span className="production-schedule-empty">—<span className="sr-only">无排期作业</span></span>}</TableCell>)}</TableRow>)}</TableBody>
    </Table>}
    {page.total > 0 && <ProductionPagination {...page} onPageChange={value => setParams(previous => productionQuery(previous, { schedulePage: String(value) }))} />}
  </section>;
}
