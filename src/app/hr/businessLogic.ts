import type { HrRecord } from '../../mocks/hrPreview';

export type OrgNode = { row: HrRecord; children: OrgNode[] };
export type MeetingAction = { id: string; title: string; owner: string; deadline: string; taskId?: string };
function parentOf(rows: HrRecord[], row: HrRecord) {
  return rows.find(parent => parent.id === row.fields['上级部门'] || parent.title === row.fields['上级部门']);
}
export function orgHasCycle(rows: HrRecord[]): boolean {
  return rows.some(row => {
    const visited = new Set<string>();
    let current: HrRecord | undefined = row;
    while (current) {
      if (visited.has(current.id)) return true;
      visited.add(current.id);
      current = parentOf(rows, current);
    }
    return false;
  });
}
export function buildOrgTree(rows: HrRecord[]): OrgNode[] {
  // Invalid legacy relationships remain inspectable; never recurse through a cycle.
  if (orgHasCycle(rows)) return rows.map(row => ({ row, children: [] }));
  const node = (row: HrRecord): OrgNode => ({ row, children: rows.filter(candidate => parentOf(rows, candidate)?.id === row.id).map(node) });
  return rows.filter(row => !parentOf(rows, row)).map(node);
}
export function nonnegativeNumber(value: string | undefined): number | null {
  if (!value?.trim() || !Number.isFinite(Number(value)) || Number(value) < 0) return null;
  return Number(value);
}
export function expenseDifference(fields: Record<string, string>): number | null {
  const voucher = nonnegativeNumber(fields['凭证金额']);
  const invoice = nonnegativeNumber(fields['发票金额']);
  return voucher === null || invoice === null ? null : Math.round((voucher - invoice) * 100) / 100;
}
export function roomBookingState(row: HrRecord | undefined, now: string): string {
  if (!row || row.status !== '已预约') return '空闲';
  const start = `${row.date}T${row.fields['开始时间']}`;
  const end = `${row.date}T${row.fields['结束时间']}`;
  if (row.fields['使用结束'] || now >= end) return '已结束';
  return now < start ? '即将开始' : '会议中';
}
export function canStartRoom(row: HrRecord | undefined, now: string): boolean {
  return Boolean(row && roomBookingState(row, now) === '会议中' && !row.fields['使用开始']);
}
export function roomUsageEndError(row: HrRecord, now: string): string {
  const timestamp = (value: string) => {
    if (!/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d{1,3})?)?$/.test(value)) return NaN;
    const time = Date.parse(`${value}Z`);
    return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === value.slice(0, 10) ? time : NaN;
  };
  const end = timestamp(now);
  if (!Number.isFinite(end)) return '演示时间无效，请填写有效日期和时间后重试。';
  const started = row.fields['使用开始'];
  if (!started) return '';
  const start = timestamp(started);
  if (!Number.isFinite(start)) return '已登记的使用开始时间无效，请核对预约使用记录。';
  return end < start ? '结束或取消时间不能早于使用开始时间，请调整演示时间。' : '';
}
export function meetingSyncPlan(meetingId: string, actions: MeetingAction[], tasks: HrRecord[]): { action: MeetingAction; task?: HrRecord }[] {
  return actions.map(action => ({ action, task: tasks.find(task => task.fields['来源纪要'] === meetingId && task.fields['来源行动编号'] === action.id) }));
}
export function readMeetingActions(row: HrRecord): MeetingAction[] {
  try {
    const saved = JSON.parse(row.fields['行动项明细'] || 'null');
    if (Array.isArray(saved)) return saved;
  } catch { /* Older notes keep their original plain-text action list. */ }
  return (row.fields['行动项'] || '').split('\n').filter(line => line.trim()).map((title, index) => ({ id: `${row.id}-A${index + 1}`, title, owner: row.fields['任务负责人'] || '', deadline: row.date }));
}
export function meetingActionError(actions: MeetingAction[], startDate: string): string {
  if (!actions.length) return '请至少添加一个行动项。';
  const validDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
  if (actions.some(action => !action.title.trim() || !action.owner.trim() || !validDate(action.deadline))) return '每个行动项都需要内容、负责人和有效截止日期。';
  if (actions.some(action => action.deadline < startDate)) return '行动项截止日期不能早于会议日期。';
  if (new Set(actions.map(action => action.id)).size !== actions.length) return '行动项编号重复，请重新添加。';
  return '';
}
export function meetingSyncError(meetingId: string, actions: MeetingAction[], tasks: HrRecord[], meetingDate: string): string {
  const actionError = meetingActionError(actions, meetingDate);
  if (actionError) return actionError;
  const plan = meetingSyncPlan(meetingId, actions, tasks);
  const invalidIndex = plan.findIndex(({ action, task }) => action.deadline < (task?.fields['开始日期'] || meetingDate));
  if (invalidIndex < 0) return '';
  const { task } = plan[invalidIndex];
  return `行动项 ${invalidIndex + 1} 的截止日期不能早于关联任务 ${task?.id || ''} 的开始日期 ${task?.fields['开始日期'] || meetingDate}。本次同步未写入任何任务。`;
}
export function meetingExportData(meetings: HrRecord[], tasks: HrRecord[]): { headers: string[]; rows: string[][] } {
  const headers = ['纪要编号', '会议名称', '所属部门', '会议负责人', '会议日期', '纪要状态', '会议结论', '行动项编号', '行动内容', '行动负责人', '行动截止日期', '关联任务编号', '任务状态', '任务当前负责人', '任务当前截止日期'];
  const rows = meetings.flatMap(meeting => {
    const common = [meeting.id, meeting.title, meeting.dept, meeting.owner, meeting.fields['会议日期'] || meeting.date, meeting.status, meeting.fields['会议结论'] || ''];
    const plan = meetingSyncPlan(meeting.id, readMeetingActions(meeting), tasks);
    if (!plan.length) return [[...common, '', '', '', '', '', '未建立行动项', '', '']];
    return plan.map(({ action, task }) => [...common, action.id, action.title, action.owner, action.deadline, task?.id || action.taskId || '', task?.status || (action.taskId ? '关联任务已缺失' : '未转任务'), task?.owner || '', task?.date || '']);
  });
  return { headers, rows };
}
export function fieldChanges(before: HrRecord, after: Partial<HrRecord>): string {
  const entries: [string, string, string][] = [];
  for (const key of ['title', 'owner', 'dept', 'status', 'date'] as const) {
    if (after[key] !== undefined && before[key] !== after[key]) entries.push([{ title: '名称', owner: '负责人', dept: '部门', status: '状态', date: '日期' }[key], before[key], after[key]]);
  }
  for (const [key, value] of Object.entries(after.fields || {})) if (value !== before.fields[key] && !key.includes('明细') && !key.includes('模型')) entries.push([key, before.fields[key] || '未填写', value || '未填写']);
  return entries.map(([name, oldValue, newValue]) => `${name}：${oldValue} → ${newValue}`).join('；');
}
export function scoreAverage(rows: HrRecord[], key: string): { count: number; average: string } {
  const scores = rows.map(row => nonnegativeNumber(row.fields[key])).filter((value): value is number => value !== null && value <= 100);
  return { count: scores.length, average: scores.length ? (scores.reduce((sum, score) => sum + score, 0) / scores.length).toFixed(1) : '—' };
}
