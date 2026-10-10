import { Link, useSearchParams } from 'react-router';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { NativeSelect } from '../../components/ui/native-select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../../components/ui/table';
import type { ExecutionPlan, ExecutionTask } from '../../lib/productionExecutionApi';
import { ProductionEmpty, ProductionPagination, ProductionStatus } from './ProductionView';
import { productionPage, productionPendingInspection, productionQuery, productionTaskState } from './productionViewState';

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

export function ProductionSchedule({ plan, prototype = false }: { plan: ExecutionPlan; prototype?: boolean }) {
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
  const tasks = plan.tasks.filter(task => matchesScope(task) && (!prototype || task.status !== 'cancelled') && validDate(task.date) && task.date >= start && task.date <= end);
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

  const columnKey = (task: ExecutionTask) => JSON.stringify([task.name, task.line, task.output, task.unit]);
  const columns = [...new Map(tasks.filter(task => task.status !== 'cancelled').map(task => [columnKey(task), { key: columnKey(task), task }])).values()];
  const rawSelectedDate = params.get('scheduleDate');
  const selectedDate = rawSelectedDate && dates.includes(rawSelectedDate) ? rawSelectedDate : tasks[0]?.date || start;
  const dayTasks = tasks.filter(task => task.date === selectedDate);
  const selectedTask = dayTasks.find(task => task.id === params.get('scheduleTask')) ?? dayTasks[0];
  const scopeTasks = plan.tasks.filter(matchesScope);
  const history = (plan.events ?? []).filter(event => ['task', 'dispatch', 'adjust', 'cancel'].includes(event.action) && scopeTasks.some(task => task.id === event.subjectId)).slice().sort((a, b) => b.at.localeCompare(a.at));
  const historyPage = productionPage(history, params.get('scheduleHistoryPage'), 6);
  const selectedReported = selectedTask?.reports.reduce((sum, row) => sum + row.quantity, 0) ?? 0;
  const selectedGood = selectedTask?.reports.reduce((sum, row) => sum + row.goodQty, 0) ?? 0;
  const taskHref = (task: ExecutionTask) => '?' + productionQuery(params, { plan: plan.id, view: 'tasks', task: task.id, taskFrom: 'schedule', taskSection: null, inspection: null, record: null, recordType: null });
  const selectDay = (date: string, taskId?: string) => update({ scheduleDate: date, scheduleTask: taskId || null });
  const eventNames: Record<string, string> = { task: '编制工序任务', dispatch: '确认派工', adjust: '调整安排', cancel: '取消任务' };
  return <section className={`production-surface production-schedule${prototype ? ' pp-schedule-compact' : ''}`} aria-label="生产日程">
    <div className="production-section-heading"><div><h2>{prototype ? '日计划与工序安排' : '生产日程'}{prototype && <span className="pp-schedule-context">{batch === 'all' ? plan.productLine + ' · 全部生产单' : plan.batches.find(row => row.id === batch)?.code || '生产单待确认'} · 生产目标 {qty(batch === 'all' ? plan.summary.batchQty : plan.batches.find(row => row.id === batch)?.quantity || 0)} 台</span>}</h2><p className={prototype ? 'production-schedule-summary' : undefined} role={prototype ? 'status' : undefined}>{prototype ? `${start} 至 ${end} · ${tasks.length} 项作业 · ${rows.size} 条产线 / 工位` : '按计划日期查看产线 / 工位安排，点击作业进入详情。'}</p></div><div className="production-schedule-navigation"><Button size="sm" variant="outline" onClick={() => moveStart(addDays(start, -dateCount))}>上一段</Button><Button size="sm" variant="outline" onClick={() => moveStart(today)}>今天</Button><Button size="sm" variant="outline" onClick={() => moveStart(addDays(start, dateCount))}>下一段</Button></div></div>
    <div className="production-toolbar production-schedule-toolbar">
      <label>显示区间<NativeSelect aria-label="日程显示区间" value={span} onChange={event => update({ scheduleSpan: event.target.value, scheduleEnd: event.target.value === 'custom' ? end : null })}><option value="3">3 天</option><option value="10">10 天</option><option value="custom">自定义</option></NativeSelect></label>
      <label>开始日期<Input aria-label="日程开始日期" type="date" max="9999-12-31" value={start} onChange={event => moveStart(event.target.value)} /></label>
      {span === 'custom' && <label>结束日期<Input aria-label="日程结束日期" type="date" min={start} max={maxEnd} value={end} onChange={event => { const value = event.target.value; if (validDate(value)) update({ scheduleEnd: value < start ? start : value > maxEnd ? maxEnd : value }); }} /></label>}
      <NativeSelect aria-label="日程产线或工位" value={line} onChange={event => filter('scheduleLine', event.target.value)}><option value="all">全部产线 / 工位</option>{lines.map(value => <option key={value} value={value}>{value === UNASSIGNED ? '产线 / 工位待确认' : value}</option>)}</NativeSelect>
      <NativeSelect aria-label="日程负责人" value={owner} onChange={event => filter('scheduleOwner', event.target.value)}><option value="all">全部负责人</option>{[...owners].map(([id, name]) => <option key={id} value={id}>{name}{ownerNames.filter(value => value === name).length > 1 ? ` · ${id}` : ''}</option>)}</NativeSelect>
      <NativeSelect aria-label="日程批次" value={batch} onChange={event => filter('scheduleBatch', event.target.value)}><option value="all">全部批次</option>{plan.batches.map(value => <option key={value.id} value={value.id}>{value.code}</option>)}</NativeSelect>
    </div>
    {(!prototype || span === 'custom' || undated > 0) && <div className="production-schedule-summary" role="status">{!prototype && <span>{start} 至 {end} · {tasks.length} 项作业 · {rows.size} 条产线 / 工位</span>}<span>{span === 'custom' ? '自定义区间最多 31 天。' : ''}{undated > 0 ? ` ${undated} 项作业尚未填写计划日期。` : ''}</span></div>}
    {span === 'custom' && requestedEnd !== end && <p className="production-schedule-notice" role="alert">日期区间已限制为开始日起最多 31 天，结束日期不能早于开始日期。</p>}
    {!tasks.length ? <ProductionEmpty title={plan.tasks.length ? '当前日程没有匹配的作业' : '还没有排期作业'} description={plan.tasks.length ? '调整日期、产线、负责人或批次筛选后重试。' : '在批次中编制作业并填写计划日期后，安排会显示在这里。'} /> : prototype ? <Table className="production-table pp-schedule-matrix" containerClassName="production-schedule-scroll" aria-label="批次日计划与工序安排">
      <TableHeader><TableRow><TableHead scope="col">日期</TableHead><TableHead scope="col">星期</TableHead>{columns.map(column => <TableHead scope="col" key={column.key}><span className="pp-schedule-column-name" title={column.task.name}>{column.task.name}</span><small>{column.task.line || '产线待定'} · {column.task.unit}</small></TableHead>)}</TableRow></TableHeader>
      <TableBody>{dates.map(date => <TableRow key={date} data-state={date === selectedDate ? 'selected' : undefined}><TableHead scope="row" className="pp-schedule-day"><Button variant="unstyled" className="pp-schedule-date-button" aria-label={`查看 ${date} 日计划`} aria-pressed={date === selectedDate} onClick={() => selectDay(date)}><time dateTime={date}>{date.slice(5)}</time>{date === today && <span>今天</span>}</Button></TableHead><TableCell>{['周日','周一','周二','周三','周四','周五','周六'][new Date(date + 'T00:00:00Z').getUTCDay()]}</TableCell>{columns.map(column => {
        const entries = tasks.filter(task => task.date === date && columnKey(task) === column.key && task.status !== 'cancelled');
        return <TableCell key={column.key}>{entries.length ? entries.map(task => <Button variant="unstyled" key={task.id} className="pp-schedule-entry" title={`${task.name} · ${plan.batches.find(row => row.id === task.batchId)?.code || '生产单待确认'} · ${productionTaskState(task).label} · ${task.ownerName || '负责人待确认'}`} aria-label={`查看 ${task.date} ${task.name}，计划 ${qty(task.quantity)} ${task.unit}`} aria-pressed={selectedTask?.id === task.id} onClick={() => selectDay(date, task.id)}><span>{task.name}</span><strong>{qty(task.quantity)} {task.unit}</strong></Button>) : '—'}</TableCell>;
      })}</TableRow>)}</TableBody>
    </Table> : <Table className="production-schedule-table" containerClassName="production-schedule-scroll" aria-label="生产日程矩阵">
      <TableHeader><TableRow><TableHead scope="col" className="production-schedule-line">产线 / 工位</TableHead>{dates.map(date => <TableHead key={date} scope="col" className="production-schedule-date" data-today={date === today || undefined}><time dateTime={date}>{date.slice(5)}</time><span>{['周日', '周一', '周二', '周三', '周四', '周五', '周六'][new Date(`${date}T00:00:00Z`).getUTCDay()]}</span>{date === today && <span>今天</span>}</TableHead>)}</TableRow></TableHeader>
      <TableBody>{page.rows.map(row => <TableRow key={row}><TableHead scope="row" className="production-schedule-line">{row === UNASSIGNED ? '产线 / 工位待确认' : row}</TableHead>{dates.map(date => <TableCell key={date} className="production-schedule-cell">{rows.get(row)?.get(date)?.map(task => {
        const state = productionTaskState(task), batchName = plan.batches.find(value => value.id === task.batchId)?.code || '批次待确认';
        const href = `?${productionQuery(params, { plan: plan.id, view: 'tasks', task: task.id, taskFrom: 'schedule', taskSection: null, inspection: null, record: null, recordType: null })}`;
        return <Link key={task.id} className="production-schedule-task" data-cancelled={task.status === 'cancelled' || undefined} to={href} aria-label={`${task.name}，${date}，${row === UNASSIGNED ? '产线待确认' : row}，${state.label}`}><div className="production-schedule-task-heading"><strong>{task.name}</strong><ProductionStatus tone={['draft', 'quality', 'inspection'].includes(state.key) ? 'warning' : 'neutral'}>{state.label}</ProductionStatus></div><span>{batchName} · {task.ownerName || '负责人待确认'}</span><span className="production-schedule-quantity">计划 {qty(task.quantity)} {task.unit}</span>{task.status !== 'cancelled' && <span>已报 {qty(task.reports.reduce((sum, report) => sum + report.quantity, 0))} {task.unit}</span>}</Link>;
      }) || <span className="production-schedule-empty">—<span className="sr-only">无排期作业</span></span>}</TableCell>)}</TableRow>)}</TableBody>
    </Table>}
    {prototype && <div className="pp-schedule-details" aria-label="排程明细">
      <section className="pp-schedule-day-detail">
        <div className="production-section-heading"><div><h2>{selectedDate.slice(5)} 日计划详情</h2><p>{selectedTask ? `${selectedTask.name} · ${selectedTask.line || '产线待确认'}` : '选择日期或工序查看详情'}</p></div></div>
        {!selectedTask ? <ProductionEmpty title="当天没有安排工序" description="选择其他日期查看已有日计划。" /> : <>
          <dl className="pp-schedule-day-metrics"><div><dt>计划数量</dt><dd>{qty(selectedTask.quantity)}<small>{selectedTask.unit}</small></dd></div><div><dt>已报工</dt><dd>{qty(selectedReported)}<small>{selectedTask.unit}</small></dd></div><div><dt>报工良品</dt><dd>{qty(selectedGood)}<small>{selectedTask.unit}</small></dd></div><div><dt>待报工</dt><dd>{qty(Math.max(0, selectedTask.quantity - selectedReported))}<small>{selectedTask.unit}</small></dd></div><div><dt>待终检</dt><dd>{qty(productionPendingInspection(selectedTask))}<small>{selectedTask.unit}</small></dd></div></dl>
          <div className="pp-schedule-day-footer"><span>{plan.batches.find(row => row.id === selectedTask.batchId)?.code || '生产单待确认'} · {selectedTask.ownerName || '负责人待确认'} · {productionTaskState(selectedTask).label}</span><Link className="production-link" to={taskHref(selectedTask)}>进入原任务</Link></div>
          <p className="pp-footnote">报工良品来自现场报工；验收与检验记录在原任务查看。</p>
        </>}
      </section>
      <section className="pp-schedule-operation-detail">
        <div className="production-section-heading"><h2>工序安排 <small>（{selectedDate.slice(5)}）</small></h2></div>
        {!dayTasks.length ? <ProductionEmpty title="当天没有工序安排" /> : <ul className="pp-schedule-operations">{dayTasks.map(task => <li key={task.id} data-selected={selectedTask?.id === task.id || undefined}><Button variant="unstyled" aria-pressed={selectedTask?.id === task.id} onClick={() => selectDay(task.date, task.id)}><strong>{task.name}</strong><span>{task.line || '产线待确认'}</span><span>计划 {qty(task.quantity)} {task.unit}</span></Button><Link className="production-link" to={taskHref(task)} aria-label={`打开 ${task.name} 原任务`}>查看</Link></li>)}</ul>}
      </section>
      <section className="pp-schedule-change-detail">
        <div className="production-section-heading"><h2>变更确认与日志</h2></div>
        <p className="pp-schedule-change-note">调整日期、产线、负责人或数量时保留原任务与调整依据。</p>
        <details className="pp-schedule-history-disclosure"><summary>查看变更日志 <span>{history.length}</span></summary>
          {!history.length ? <ProductionEmpty title="当前范围没有计划变更记录" /> : <ol className="pp-schedule-history">{historyPage.rows.map(event => {
            const task = scopeTasks.find(row => row.id === event.subjectId)!;
            const change = event.adjustment;
            const differences = change ? [change.before.date !== change.after.date ? `日期：${change.before.date} → ${change.after.date}` : '', change.before.line !== change.after.line ? `产线：${change.before.line || '待确认'} → ${change.after.line || '待确认'}` : '', change.before.ownerId !== change.after.ownerId ? `负责人：${change.before.ownerName} → ${change.after.ownerName}` : '', change.before.quantity !== change.after.quantity ? `数量：${qty(change.before.quantity)} → ${qty(change.after.quantity)} ${task.unit}` : ''].filter(Boolean) : [];
            return <li key={event.id}><strong>{eventNames[event.action]} · <Link className="production-link" to={taskHref(task)}>{task.name}</Link></strong><time dateTime={event.at}>{new Date(event.at).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false })}</time>{differences.length > 0 && <ul>{differences.map(value => <li key={value}>{value}</li>)}</ul>}<p>{event.reason}</p><span>{event.actorName} · {plan.batches.find(row => row.id === task.batchId)?.code || '生产单待确认'}</span></li>;
          })}</ol>}
          {historyPage.total > 6 && <ProductionPagination {...historyPage} onPageChange={value => update({ scheduleHistoryPage: String(value) })} />}
        </details>
      </section>
    </div>}
    {!prototype && page.total > 0 && <ProductionPagination {...page} onPageChange={value => setParams(previous => productionQuery(previous, { schedulePage: String(value) }))} />}
  </section>;
}
