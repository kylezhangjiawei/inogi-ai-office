import type { ReactNode } from 'react';
import { ArrowRight, CalendarDays, FileText, History } from 'lucide-react';
import { Button } from '../../components/ui/button';
import { cn } from '../../components/ui/utils';
import { i18nLocale, useI18n } from '../../lib/i18n';
import { getOperationTotals, getTaskProgress } from './planningModel';
import { planningActionLabels, planningStatusLabels, type PlanningActionContext, type PlanningDocument, type PlanningEvent, type PlanningState, type PlanningTask, type PlanningView } from './planningTypes';
import './planning-sections.css';

export interface PlanningSectionsProps {
  state: PlanningState;
  batchId: string;
  view: PlanningView;
  tasks: PlanningTask[];
  selectedTaskId?: string;
  dates: string[];
  readOnly: boolean;
  onSelectTask: (id: string) => void;
  onAction: (context: PlanningActionContext) => void;
  onDocument: (document: PlanningDocument) => void;
}

export function PlanningSections({ state, batchId, view, tasks, selectedTaskId, dates, readOnly, onSelectTask, onAction, onDocument }: PlanningSectionsProps) {
  const { t } = useI18n();
  const batch = state.batches.find((item) => item.id === batchId);
  const number = (value: number) => value.toLocaleString(i18nLocale(), { maximumFractionDigits: 3 });
  const amount = (value: number, unit = '') => `${number(value)}${unit ? ` ${t(unit)}` : ''}`;
  const person = (id: string) => state.actors.find((item) => item.id === id)?.name || t('人员待确认');
  const line = (id: string) => state.lines.find((item) => item.id === id)?.name || t('产线待确认');
  const time = (value: string) => new Date(value).toLocaleString(i18nLocale(), { timeZone: 'Asia/Shanghai', hour12: false });
  const day = (value: string) => new Date(`${value}T00:00:00+08:00`).toLocaleDateString(i18nLocale(), { timeZone: 'Asia/Shanghai', weekday: 'short' });
  const title = (heading: string, description?: string) => <header className="pls-heading"><h2>{t(heading)}</h2>{description && <p>{t(description)}</p>}</header>;
  const empty = (heading: string, description: string, action?: ReactNode) => <div className="pls-empty"><CalendarDays className="size-5" aria-hidden="true" /><div><strong>{t(heading)}</strong><p>{t(description)}</p>{action}</div></div>;
  if (!batch) return empty('未找到批次计划', '请从批次列表重新选择。');
  const batchTasks = state.tasks.filter((item) => item.batchId === batch.id);
  const visibleTasks = tasks;
  const scheduledTasks = tasks.filter((item) => item.batchId === batch.id);
  const operation = (id: string) => batch.operations.find((item) => item.id === id);
  const taskById = (id: string) => batchTasks.find((item) => item.id === id);
  const status = (task: PlanningTask) => <span className={cn('pls-status', `pls-status-${task.status}`)}>{t(planningStatusLabels[task.status])}</span>;
  const selectButton = (task: PlanningTask, label = '查看任务') => <Button type="button" size="sm" variant={selectedTaskId === task.id ? 'secondary' : 'outline'} className="pls-select" aria-label={t('{label} {code}', { label: t(label), code: task.code })} aria-pressed={selectedTaskId === task.id} onClick={() => onSelectTask(task.id)}>{t(selectedTaskId === task.id ? '已选中' : label)}<ArrowRight className="size-3.5" aria-hidden="true" /></Button>;
  const createButton = !readOnly && batch.status === 'active' ? <Button type="button" size="sm" onClick={() => onAction({ kind: 'create', batchId: batch.id })}>{t('新增组件任务')}</Button> : undefined;
  const cell = (label: string, children: ReactNode) => <td data-label={t(label)}>{children}</td>;
  const table = (headers: string[], rows: ReactNode, caption: string) => <div className="pls-table-wrap"><table className="pls-table"><caption className="sr-only">{t(caption)}</caption><thead><tr>{headers.map((heading) => <th key={heading} scope="col">{t(heading)}</th>)}</tr></thead><tbody>{rows}</tbody></table></div>;

  const operationTotals = <section className="pls-operation-section">{title('当前批次工序核对', t('{batch} · 按本批全部有效任务核对需求，包含筛选范围外的安排。', { batch: batch.code }))}<div className="pls-operation-grid">{batch.operations.map((item) => {
    const totals = getOperationTotals(state, batch.id, item.id);
    return <div className="pls-operation" key={item.id}><h3>{item.component}<span>{item.process}</span></h3><dl className="pls-operation-numbers"><div><dt>{t('需求')}</dt><dd>{amount(totals.required, item.unit)}</dd></div><div><dt>{t('已安排')}</dt><dd>{amount(totals.planned, item.unit)}</dd></div><div><dt>{t('未安排')}</dt><dd className={totals.unplanned > 0 ? 'pls-pending' : undefined}>{amount(totals.unplanned, item.unit)}</dd></div></dl>{item.documents.length > 0 && <details className="pls-details"><summary>{t('作业资料')} · {item.documents.length} {t('份')}</summary><div className="pls-documents">{item.documents.map((source) => <Button key={source.id} type="button" size="sm" variant="link" className="pls-source" aria-label={t('查看资料摘要 {code}', { code: source.code })} onClick={() => onDocument(source)}><FileText className="size-3.5" aria-hidden="true" /><span>{source.code} · {source.version}{source.status === 'pending' ? ` · ${t('待确认')}` : ''}</span></Button>)}</div></details>}</div>;
  })}</div><p className="pls-note">{t('组件与工序数量分别核对，不相加作为整机完工。齐套只说明物料条件，排程由计划员确认。')}</p></section>;

  if (view === 'tasks') return <div className="pls-sections"><section>{title('组件任务清单', '剩余按计划减合格，包含待返工。选择任务后查看当前安排及操作。')}{visibleTasks.length ? table(['日期 / 任务 / 批次', '产线 / 负责人', '组件 / 工序', '数量进度', '状态', '操作'], visibleTasks.map((task) => {
    const taskBatch = state.batches.find((item) => item.id === task.batchId), item = taskBatch?.operations.find((item) => item.id === task.operationId), progress = getTaskProgress(task);
    return <tr key={task.id} className={cn(selectedTaskId === task.id && 'pls-selected-row')}>{cell('日期 / 任务 / 批次', <><strong className="pls-numeric">{task.date}</strong><p className="pls-code">{task.code}</p><p className="pls-code">{taskBatch?.code || t('批次待确认')}</p>{task.actualDate && task.actualDate !== task.date && <p>{t('实际')} {task.actualDate}</p>}</>)}{cell('产线 / 负责人', <><strong>{line(task.lineId)}</strong><p>{person(task.ownerId)}</p>{task.actualLineId && task.actualLineId !== task.lineId && <p>{t('实际')} · {line(task.actualLineId)}</p>}</>)}{cell('组件 / 工序', <><strong>{item?.component || t('组件待确认')}</strong><p>{item?.process || t('工序待确认')}</p></>)}{cell('数量进度', <div className="pls-progress"><div><span>{t('计划')}</span><strong>{amount(task.quantity, item?.unit)}</strong></div><div><span>{t('合格')}</span><strong>{amount(progress.qualified, item?.unit)}</strong></div><div><span>{t('剩余')}</span><strong>{amount(progress.remaining, item?.unit)}</strong></div><p>{t('已报工')} {amount(progress.reported, item?.unit)} · {t('待返工')} {amount(progress.rework, item?.unit)}</p></div>)}{cell('状态', <>{status(task)}{task.status === 'cancelled' && <p>{t('不再计入计划')}</p>}</>)}{cell('操作', selectButton(task))}</tr>;
  }), '组件任务清单') : empty('当前范围没有组件任务', readOnly ? '可调整上方筛选，查看本批其他安排。' : '可调整上方筛选，或新增本批组件任务。', createButton)}</section>{operationTotals}</div>;

  if (view === 'schedule') return <div className="pls-sections"><section>{title('批次每日安排', '每个格子对应一项工序的当日任务；点击后在右侧核对与操作。')}{dates.length && batch.operations.length ? <div className="pls-schedule-wrap"><table className="pls-schedule"><caption className="sr-only">{t('按日期与工序查看批次日安排')}</caption><thead><tr><th scope="col">{t('计划日期')}</th>{batch.operations.map((item) => <th key={item.id} scope="col"><strong>{item.component}</strong><span>{item.process} · {t(item.unit)}</span></th>)}</tr></thead><tbody>{dates.map((date) => <tr key={date}><th scope="row" className="pls-schedule-date"><span className="pls-numeric">{date}</span><small>{day(date)}</small></th>{batch.operations.map((item) => {
    const scheduled = scheduledTasks.filter((task) => task.date === date && task.operationId === item.id);
    return <td key={item.id} data-operation={`${item.component} · ${item.process}`}><div className="pls-schedule-cell">{scheduled.length ? scheduled.map((task) => <Button variant="unstyled" type="button" className={cn('pls-schedule-task', selectedTaskId === task.id && 'pls-schedule-task-selected')} key={task.id} onClick={() => onSelectTask(task.id)} aria-pressed={selectedTaskId === task.id} aria-label={t('查看任务 {code}，{date}，{component}，{quantity}', { code: task.code, date: task.date, component: item.component, quantity: amount(task.quantity, item.unit) })}><span className="pls-schedule-task-head"><strong>{task.code}</strong>{status(task)}</span><span>{line(task.lineId)} · {person(task.ownerId)}</span><span className="pls-schedule-task-quantity">{t('计划')} <strong>{amount(task.quantity, item.unit)}</strong><ArrowRight className="size-3.5" aria-hidden="true" /></span></Button>) : <span className="pls-no-plan">{t('当前筛选下无安排')}</span>}</div></td>;
  })}</tr>)}</tbody></table></div> : empty('当前区间暂无可展示的日安排', '请调整上方日期范围，或先补齐本批工序。', createButton)}</section>{operationTotals}</div>;

  if (view === 'dispatches') {
    const dispatches = state.dispatches.filter((item) => taskById(item.taskId));
    const requests = state.materialRequests.filter((item) => taskById(item.taskId));
    return <div className="pls-sections"><section>{title('本批全部派工', '不按日期筛选。展示当前派工版本；原安排与调整原因保留在变更记录中。')}{dispatches.length ? table(['派工 / 任务', '当前安排', '当前派工量', '首次确认', '操作'], [...dispatches].reverse().map((dispatch) => {
      const task = taskById(dispatch.taskId)!;
      return <tr key={dispatch.id}>{cell('派工 / 任务', <><strong className="pls-code">{dispatch.code}</strong><p>{task.code} · {t('第 {version} 版', { version: dispatch.taskRevision })}</p></>)}{cell('当前安排', <><strong>{line(dispatch.lineId)}</strong><p>{dispatch.date} · {person(dispatch.ownerId)}</p></>)}{cell('当前派工量', <span className="pls-numeric">{amount(dispatch.quantity, operation(task.operationId)?.unit)}</span>)}{cell('首次确认', <><span>{person(dispatch.actorId)}</span><p className="pls-numeric">{time(dispatch.confirmedAt)}</p></>)}{cell('操作', selectButton(task, '查看当前任务'))}</tr>;
    }), '本批已确认派工') : empty('本批暂无已确认派工', '选择组件任务并确认派工后，可在这里查看当前安排与任务版本。')}</section><section>{title('本批全部用料需求', '不按日期筛选。逐行核对需求、已发与待发；演示记录尚未写入采购或现场系统。')}{requests.length ? <div className="pls-request-list">{[...requests].reverse().map((request) => {
      const task = taskById(request.taskId)!;
      return <details className="pls-request" key={request.id}><summary><span><strong>{request.code}</strong><small>{task.code} · {t('第 {version} 版', { version: request.taskRevision })}</small></span><span className="pls-request-meta">{t('需求日期')} {request.neededDate}<small>{request.lines.length} {t('项物料')} · {t('展开用料明细')}</small></span></summary><div>{request.lines.length ? table(['物料', '需求量', '已发', '待发'], request.lines.map((material) => <tr key={material.materialId}>{cell('物料', <><strong>{material.name}</strong><p className="pls-code">{material.code}</p></>)}{cell('需求量', <span className="pls-numeric">{amount(material.quantity, material.unit)}</span>)}{cell('已发', <span className="pls-numeric">{amount(material.issued, material.unit)}</span>)}{cell('待发', <span className="pls-numeric">{amount(Math.max(0, material.quantity - material.issued), material.unit)}</span>)}</tr>), '派工物料需求明细') : <p className="pls-note">{t('尚无已归集的用料明细，不能按组件数量推定物料需求。')}</p>}</div></details>;
    })}</div> : empty('本批暂无用料需求记录', '确认派工时按对应 BOM 用量生成本页演示需求。')}</section></div>;
  }

  const fieldLabels: Record<string, string> = { id: '记录编号', code: '编号', taskId: '关联任务', batchId: '生产批次', operationId: '组件 / 工序', date: '计划日期', lineId: '计划产线', ownerId: '负责人', quantity: '计划数量', reported: '已报工', qualified: '合格数量', rework: '待返工数量', status: '任务状态', actualDate: '实际日期', actualLineId: '实际产线', note: '说明', revision: '任务版本', taskRevision: '派工任务版本', actorId: '操作人', confirmedAt: '首次确认时间', reason: '调整原因', dispatch: '派工快照', materialRequest: '用料需求快照', neededDate: '需求日期', lines: '用料明细', materialId: '物料', name: '物料名称', unit: '数量单位', issued: '已发数量' };
  function snapshot(event: PlanningEvent, values: PlanningEvent['before']) {
    if (!Object.keys(values).length) return <p className="pls-muted">{t('尚无记录')}</p>;
    const task = taskById(event.taskId), unit = task ? operation(task.operationId)?.unit : undefined;
    const display = (field: string, value: unknown, contextUnit = unit): ReactNode => {
      if (value === null || value === undefined) return t('尚无记录');
      if (value === '') return t('未填写');
      if ((field === 'dispatch' || field === 'materialRequest') && typeof value === 'string') {
        try { return display(field, JSON.parse(value), contextUnit); } catch { return t('历史明细待核对'); }
      }
      if (Array.isArray(value)) return value.length ? <ul className="pls-snapshot-list">{value.map((item, index) => <li key={index}>{display(field, item, contextUnit)}</li>)}</ul> : t('尚无记录');
      if (typeof value === 'object') {
        const record = value as Record<string, unknown>, childUnit = typeof record.unit === 'string' ? record.unit : contextUnit;
        return <dl className="pls-snapshot">{Object.entries(record).map(([key, item]) => <div key={key}><dt>{t(fieldLabels[key] || '补充记录')}</dt><dd>{display(key, item, childUnit)}</dd></div>)}</dl>;
      }
      if (field === 'ownerId' || field === 'actorId') return person(String(value));
      if (field === 'lineId' || field === 'actualLineId') return line(String(value));
      if (field === 'taskId') return taskById(String(value))?.code || t('关联任务待确认');
      if (field === 'batchId') return state.batches.find((item) => item.id === value)?.code || t('批次待确认');
      if (field === 'operationId') { const item = operation(String(value)); return item ? `${item.component} · ${item.process}` : t('工序待确认'); }
      if (field === 'materialId') return batch!.operations.flatMap((item) => item.materials).find((item) => item.id === value)?.code || t('物料待确认');
      if (field === 'status') return t(planningStatusLabels[value as keyof typeof planningStatusLabels] || String(value));
      if (['quantity', 'reported', 'qualified', 'rework', 'issued'].includes(field) && typeof value === 'number') return amount(value, contextUnit);
      if (field === 'confirmedAt') return time(String(value));
      return String(value);
    };
    return display('', values);
  }
  const events = state.events.filter((event) => taskById(event.taskId));
  return <div className="pls-sections">{title('计划变更记录', '保留新增、调整、派工及取消的原因与前后内容。')}{events.length ? <ol className="pls-history">{[...events].reverse().map((event) => <li key={event.id}><History className="size-4" aria-hidden="true" /><div><div className="pls-history-head"><h3>{t(planningActionLabels[event.kind])} · {taskById(event.taskId)?.code}</h3><span>{person(event.actorId)}</span></div><p className="pls-muted pls-numeric">{time(event.at)}</p><p>{event.reason || t('未记录补充说明')}</p><details className="pls-details"><summary>{t('查看变更前后')}</summary><div className="pls-history-comparison"><section><h4>{t('变更前')}</h4>{snapshot(event, event.before)}</section><section><h4>{t('变更后')}</h4>{snapshot(event, event.after)}</section></div></details></div></li>)}</ol> : empty('本批暂无计划变更记录', '新增、调整或确认派工后，相关记录会保留在这里。')}</div>;
}
