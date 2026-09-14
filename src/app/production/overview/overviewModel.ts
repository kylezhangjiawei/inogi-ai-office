import type { PlanningState } from '../planning/planningTypes';
import type { InspectionState } from '../inspections/inspectionTypes';
import type { DefectState } from '../defects/defectTypes';
import type { EcnState } from '../ecn/ecnTypes';

export type ProductionTaskKind = 'planning' | 'inspection' | 'defect' | 'transfer' | 'ecn';
export interface ProductionTaskRow {
  key: string; code: string; kind: ProductionTaskKind; date: string; dueDate: string | null;
  batch: string; subject: string; lineId: string | null; owner: string; node: string;
  status: 'open' | 'done'; risk: string; href: string; summary: string;
}
export interface OverviewSources { planning: PlanningState; inspections: InspectionState; defects: DefectState; ecn: EcnState; transfers?: ProductionTaskRow[]; defectWorkflows?: Record<string, { owner: string; node: string; href: string; summary: string }> }
export interface TaskFilters { month: string; scope: string; line: string; owner: string; kind: string; status: string; query: string }
export const taskKindLabels: Record<ProductionTaskKind, string> = { planning: '计划与派工', inspection: '检验与复验', defect: '不良与研发', transfer: '转产验证', ecn: 'ECN 待办' };
export const taskDateLabels: Record<ProductionTaskKind, string> = { planning: '计划日期', inspection: '报检日期', defect: '发现日期', transfer: '计划转产日期', ecn: '待办创建日期' };
export const lineLabels: Record<string, string> = { 'line-a': '装配 A 线', 'line-b': '装配 B 线', unassigned: '未分线' };
export const validMonth = (month: string) => /^\d{4}-(0[1-9]|1[0-2])$/.test(month);
export function validDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
export function productionToday() { return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()); }
export function shiftMonth(month: string, shift: number) {
  if (!validMonth(month)) throw new Error('请选择有效月份');
  const date = new Date(`${month}-01T00:00:00Z`); date.setUTCMonth(date.getUTCMonth() + shift); return date.toISOString().slice(0, 7);
}

// A projection of source records, never a second writable task ledger.
export function aggregateProductionTasks(source: OverviewSources): ProductionTaskRow[] {
  const rows: ProductionTaskRow[] = [];
  const p = source.planning;
  for (const task of p.tasks.filter((task) => task.status !== 'cancelled')) {
    const batch = p.batches.find((item) => item.id === task.batchId);
    const operation = batch?.operations.find((item) => item.id === task.operationId);
    if (!batch || !operation) continue;
    rows.push({ key: `planning:${task.id}`, code: task.code, kind: 'planning', date: task.date, dueDate: task.date,
      batch: batch.code, subject: `${operation.component} · ${operation.process}`, lineId: task.lineId,
      owner: p.actors.find((item) => item.id === task.ownerId)?.name ?? '待指派',
      node: ({ draft: '待派工', dispatched: '待接收', 'in-progress': '现场执行', completed: '已完成' } as Record<string, string>)[task.status],
      status: task.status === 'completed' ? 'done' : 'open',
      risk: task.status !== 'completed' && operation.documents.some((doc) => doc.status !== 'published') ? '资料待发布' : task.rework > 0 ? '返工待验' : '',
      href: `/__preview/production-planning?month=${task.date.slice(0, 7)}&batch=${batch.id}&task=${task.id}&view=tasks`,
      summary: `计划 ${task.quantity} ${operation.unit}；报工 ${task.reported}；合格完成 ${task.qualified}；返工待验 ${task.rework}。${task.note}` });
  }
  for (const task of source.inspections.tasks) {
    const initial = source.inspections.records.filter((item) => item.taskId === task.id && item.kind === 'initial').reduce((sum, item) => sum + item.quantity, 0);
    rows.push({ key: `inspection:${task.id}`, code: task.code, kind: 'inspection', date: task.date, dueDate: null,
      batch: task.batchCode, subject: `${task.stage === 'final' ? '终检' : '过程检'} · ${task.process}`, lineId: null,
      owner: source.inspections.actors.find((item) => item.id === task.acceptedBy)?.name ?? '待 QC 接收',
      node: task.closed ? '已结案' : !task.acceptedAt ? '待接受报检' : initial < task.quantity ? '待初检' : '核对不良与放行',
      status: task.closed ? 'done' : 'open', risk: task.closed ? '' : task.documents.some((item) => item.status !== 'published') ? 'SIP 待发布' : '',
      href: `/__preview/production-inspections?task=${task.id}&tab=records`,
      summary: `报检 ${task.quantity} ${task.unit}；已初检 ${initial} ${task.unit}。原检验任务未配置产线或处理期限，不推定逾期。` });
  }
  for (const issue of source.defects.issues) {
    rows.push({ key: `defect:${issue.id}`, code: issue.code, kind: 'defect', date: issue.date, dueDate: issue.dueDate,
      batch: issue.batchCode, subject: `${issue.phenomenon} · ${issue.material}`, lineId: issue.lineId,
      owner: source.defects.actors.find((item) => item.id === issue.ownerId)?.name ?? '待指派',
      node: issue.closedAt ? '已关闭' : ({ pending: '待定处理方向', onsite: '现场整改 / 复验', rd: '研发协同', procurement: '采购协同' })[issue.direction],
      status: issue.closedAt ? 'done' : 'open', risk: !issue.closedAt && issue.priority === 'high' ? '高优先异常' : '',
      href: `/__preview/${issue.direction === 'rd' ? 'production-rd' : 'production-defects'}?issue=${issue.id}`,
      summary: `原不良范围 ${issue.quantity} ${issue.unit}；来源 ${issue.sourceCode}。${issue.description}`,
      ...(!issue.closedAt ? source.defectWorkflows?.[issue.id] : {}) });
  }
  for (const record of source.ecn.records) for (const task of record.tasks) {
    const impact = record.impacts.find((item) => item.id === task.impactId);
    const owner = source.ecn.actors.find((item) => item.id === task.ownerId);
    rows.push({ key: `ecn:${record.id}:${task.id}`, code: task.code, kind: 'ecn', date: task.at.slice(0, 10), dueDate: task.dueDate,
      batch: impact?.batchNo ?? '待核对范围', subject: record.title,
      lineId: owner?.id === 'line-a' || owner?.id === 'line-b' ? owner.id : null,
      owner: owner?.name ?? '待核对经办人', node: task.status === 'resolved' ? '已处理' : '变更执行待办',
      status: task.status === 'resolved' ? 'done' : 'open', risk: '',
      href: `/__preview/ecn?ecn=${record.id}&tab=tasks`, summary: `${record.code} · ${task.description}` });
  }
  rows.push(...(source.transfers ?? []));
  return [...new Map(rows.map((row) => [row.key, row])).values()];
}
export function inScope(row: ProductionTaskRow, scope: string) { return scope === 'all' || row.lineId === scope; }
export function isOverdue(row: ProductionTaskRow, today: string) { return row.status === 'open' && row.dueDate !== null && validDate(row.dueDate) && row.dueDate < today; }
export function selectProductionTasks(rows: ProductionTaskRow[], filters: TaskFilters, today: string) {
  const scoped = rows.filter((row) => inScope(row, filters.scope));
  const needle = filters.query.trim().toLocaleLowerCase();
  const selected = scoped.filter((row) => row.date.slice(0, 7) === filters.month &&
    (filters.line === 'all' || (row.lineId ?? 'unassigned') === filters.line) &&
    (filters.owner === 'all' || row.owner === filters.owner) && (filters.kind === 'all' || row.kind === filters.kind) &&
    (filters.status === 'all' || (filters.status === 'overdue' ? isOverdue(row, today) : row.status === filters.status)) &&
    [row.code, row.batch, row.subject, row.owner, row.node].join(' ').toLocaleLowerCase().includes(needle));
  // Month/category/search/status filters cannot conceal outstanding records in the separate reminder.
  const carry = scoped.filter((row) => row.status === 'open' && (row.date.slice(0, 7) < filters.month || (row.date.slice(0, 7) !== filters.month && isOverdue(row, today))));
  const sort = (a: ProductionTaskRow, b: ProductionTaskRow) => Number(isOverdue(b, today)) - Number(isOverdue(a, today)) || (a.dueDate ?? '9999').localeCompare(b.dueDate ?? '9999') || a.code.localeCompare(b.code);
  return { selected: selected.sort(sort), carry: carry.sort(sort), scoped };
}
export function monthlyOverview(source: OverviewSources, month: string) {
  if (!validMonth(month)) throw new Error('请选择有效月份');
  const target = source.planning.products.reduce((sum, item) => sum + (item.monthlyTargets[month] ?? 0), 0);
  const completions = source.planning.batches.filter((item) => item.completedDate?.slice(0, 7) === month);
  const completed = completions.reduce((sum, item) => sum + item.completed, 0);
  const finalTasks = new Set(source.inspections.tasks.filter((task) => task.stage === 'final' && task.unit === '台').map((task) => task.id));
  const initial = source.inspections.records.filter((item) => finalTasks.has(item.taskId) && item.kind === 'initial' && item.date.slice(0, 7) === month);
  const inspected = initial.reduce((sum, item) => sum + item.quantity, 0), good = initial.reduce((sum, item) => sum + item.good, 0);
  return { target, completed, remaining: Math.max(0, target - completed), completions, inspected, good, firstPassRate: inspected ? good / inspected * 100 : null };
}
export interface StaffingRecord { id: string; date: string; lineId: string; workers: number; qc: number; basis: string; confirmedBy: string }
export function saveStaffing(records: StaffingRecord[], input: Omit<StaffingRecord, 'id' | 'confirmedBy'>, role: string, today: string): StaffingRecord[] {
  if (!['manager', 'factory'].includes(role)) throw new Error('当前岗位仅可查看在岗记录');
  if (!validDate(input.date) || input.date > today) throw new Error('确认日期须为今天或已有日期');
  if (!['line-a', 'line-b'].includes(input.lineId)) throw new Error('请选择有效产线');
  if (![input.workers, input.qc].every((value) => Number.isSafeInteger(value) && value >= 0 && value <= 200)) throw new Error('在岗人数须为 0 至 200 的整数');
  if (!input.basis.trim() || input.basis.length > 300) throw new Error('请填写不超过 300 字的确认依据');
  return [...records, { ...input, basis: input.basis.trim(), id: `staff-${records.length + 1}`, confirmedBy: role === 'manager' ? '管理层演示岗' : '厂长演示岗' }];
}
export function latestStaffing(records: StaffingRecord[], date: string, scope: string) {
  const latest = new Map<string, StaffingRecord>();
  for (const record of records) if (record.date === date && (scope === 'all' || record.lineId === scope)) latest.set(record.lineId, record);
  return [...latest.values()];
}
