import type { HrRecord, HrState } from '../../mocks/hrPreview';

export const recurrenceOptions = ['不重复', '每天', '每周', '每月', '每季度', '每年'];
const nonnegativeFields = ['试用期月薪', '标准月薪', '标准年薪（万元）', '绩效工资', '餐补', '报销金额', '凭证金额', '发票金额', '采购金额'];
const dayFields = ['计薪天数', '实际出勤天数', '带薪病假天数', '非带薪病假天数'];
export const numericFields = [...nonnegativeFields, ...dayFields, '招聘人数', '每周工作天数', '倒挂余额（小时）', 'AI 匹配分', '自评分', '上级评分', '总经理评分', '考勤扣分建议', '扣分校准', '最多考试次数'];
const requiredFields: Record<string, string[]> = {
  tasks: ['任务类型', '开始日期', '循环周期', '验收标准'],
  org: ['上级部门', '部门定位', '核心职能', '公司主体'],
  position: ['岗位序列', '职级', '专业等级', '发展通道'],
  spec: ['岗位序列', '核心职责', '能力要求'],
  req01: ['招聘人数', '招聘原因', '核心职责', '任职要求'],
  asset: ['资产编码', '资产类型', '存放位置'],
  room: ['会议室', '开始时间', '结束时间'],
  archive: ['人员编号'],
  account: ['账号系统', '账号标识', '人员编号'],
};

const dateValid = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
export function validateHrRecord(moduleId: string, row: HrRecord, all: HrState): string | null {
  if (!row.title.trim() || !row.dept.trim() || !row.owner.trim()) return '请填写名称、所属部门和负责人。';
  if (!dateValid(row.date)) return '请填写有效的计划／截止日期。';
  const missing = (requiredFields[moduleId] || []).filter(k => !row.fields[k]?.trim());
  if (missing.length) return `请填写：${missing.join('、')}。`;
  for (const key of numericFields) {
    const value = row.fields[key];
    if (!value?.trim()) continue;
    const n = Number(value);
    if (!Number.isFinite(n) || n < 0) return `${key}必须为不小于 0 的数字。`;
    if (dayFields.includes(key) && n > 31) return `${key}不能超过 31 天。`;
    if (key === '招聘人数' && (!Number.isInteger(n) || n < 1)) return '招聘人数必须为正整数。';
    if (key === '每周工作天数' && (n < 1 || n > 7)) return '每周工作天数必须为 1–7。';
    if (/评分|匹配分|扣分/.test(key) && n > 100) return `${key}必须为 0–100。`;
    if (key === '最多考试次数' && (!Number.isInteger(n) || n < 1 || n > 10)) return '最多考试次数必须为 1–10 的整数。';
  }
  for (const [key, value] of Object.entries(row.fields)) {
    if (value?.trim() && /日期$|到岗时间$|有效期$|到期日$/.test(key) && !dateValid(value)) return `${key}日期无效。`;
  }
  if (moduleId === 'tasks') {
    if (!recurrenceOptions.includes(row.fields['循环周期'])) return '请选择有效的循环周期。';
    if (row.fields['开始日期'] > row.date) return '开始日期不能晚于截止日期。';
  }
  if (moduleId === 'asset') {
    const code = row.fields['资产编码'].trim().toLocaleUpperCase();
    if ((all.asset || []).some(r => r.id !== row.id && r.fields['资产编码']?.trim().toLocaleUpperCase() === code)) return '资产编码重复，请使用唯一编码。';
  }
  if (moduleId === 'account') {
    const system = row.fields['账号系统'].trim();
    const identifier = row.fields['账号标识'].trim();
    if (!['已注销', '已驳回'].includes(row.status) && (all.account || []).some(r => r.id !== row.id && !['已注销', '已驳回'].includes(r.status) && r.fields['账号系统']?.trim() === system && r.fields['账号标识']?.trim() === identifier)) return '该系统的账号标识已有有效申请或使用记录，请勿重复。';
    const existing = (all.account || []).find(r => r.id === row.id);
    const personId = row.fields['人员编号'].trim();
    if (existing?.fields['人员编号'] !== personId && !(all.archive || []).some(r => (r.fields['人员编号'] || r.id) === personId && r.fields['入离职状态'] !== '已离职')) return '请选择有效的在职人员编号。';
  }
  if (moduleId === 'archive' || moduleId === 'collect') {
    const existing = (all[moduleId] || []).find(r => r.id === row.id);
    const personId = row.fields['人员编号']?.trim();
    if (existing?.fields['人员编号'] && existing.fields['人员编号'] !== personId) return '已分配的人员编号不可更改，以免破坏关联。';
    if (personId && (all[moduleId] || []).some(r => r.id !== row.id && r.fields['人员编号']?.trim() === personId)) return '人员编号重复，请核对人员身份。';
    if (moduleId === 'collect') {
      const candidateId = row.fields['候选人编号']?.trim();
      if (existing?.fields['候选人编号'] && existing.fields['候选人编号'] !== candidateId) return '已关联的候选人编号不可更改，以免破坏招聘记录。';
      if (candidateId && Object.values(all).flat().some(r => r.fields['候选人编号']?.trim() === candidateId && r.fields['人员编号']?.trim() && r.fields['人员编号'].trim() !== personId)) return '候选人编号已关联其他人员，请核对候选人及人员编号。';
    }
  }
  if (moduleId === 'org') {
    const departments = all.org || [];
    if (departments.some(r => r.id !== row.id && r.title.trim() === row.title.trim())) return '部门名称重复。';
    const previousName = departments.find(r => r.id === row.id)?.title;
    const names = new Map(departments.filter(r => r.id !== row.id).map(r => [r.title, r.fields['上级部门'] === previousName ? row.title : r.fields['上级部门']]));
    names.set(row.title, row.fields['上级部门']);
    const seen = new Set([row.title]);
    let parent = row.fields['上级部门'];
    while (parent && names.has(parent)) {
      if (seen.has(parent)) return '上级部门形成循环引用，请调整汇报关系。';
      seen.add(parent);
      parent = names.get(parent) || '';
    }
    if (row.fields['上级部门'] === row.title) return '部门不能作为自己的上级，避免循环引用。';
  }
  if (moduleId === 'room') {
    const start = row.fields['开始时间'];
    const end = row.fields['结束时间'];
    if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(start) || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(end) || start >= end) return '结束时间必须晚于开始时间。';
    if (row.status !== '已取消' && (all.room || []).some(r => r.id !== row.id && r.status !== '已取消' && r.date === row.date && r.fields['会议室'] === row.fields['会议室'] && r.fields['开始时间'] < end && start < r.fields['结束时间'])) return '该会议室在所选时间已被预约，请调整时间或会议室。';
  }
  if (moduleId === 'collect' || moduleId === 'apply' || moduleId === 'offer' || moduleId === 'archive') {
    const email = row.fields['个人邮箱'] || row.fields['收件邮箱'];
    if (email?.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return '请填写有效的邮箱地址。';
    const phone = row.fields['联系电话'];
    if (phone?.trim() && !/^[+\d\s*()\-]{6,22}$/.test(phone)) return '联系电话格式不正确。';
  }
  return null;
}

function normalizeIdentityFields(fields: Record<string, string>) {
  return Object.fromEntries(Object.entries(fields).map(([key, value]) => [key, ['人员编号', '候选人编号', '账号系统', '账号标识'].includes(key) ? value.trim() : value]));
}

export function prepareHrNewRecord(moduleId: string, record: Omit<HrRecord, 'id' | 'history'>, all: HrState) {
  const fields = normalizeIdentityFields(record.fields);
  if (moduleId !== 'collect') return { ...record, fields };
  const records = Object.values(all).flat();
  for (const [key, prefix] of [['人员编号', 'E'], ['候选人编号', 'C']]) {
    if (fields[key]?.trim()) continue;
    const maximum = records.reduce((n, row) => Math.max(n, Number(row.fields[key]?.match(new RegExp(`^${prefix}-(\\d+)$`))?.[1] || 0)), 0);
    fields[key] = `${prefix}-${String(maximum + 1).padStart(3, '0')}`;
  }
  return { ...record, fields };
}

const criticalFields: Record<string, string[]> = {
  req01: ['招聘人数', '招聘原因', '核心职责', '任职要求', 'JD 初稿'],
  offer: ['拟录用岗位', '预计到岗时间', '试用期月薪', '标准月薪', '标准年薪（万元）', '每周工作天数', '有效期', '候选人说明', '业务部门评价'],
};
export function prepareHrUpdate(moduleId: string, previous: HrRecord, patch: Partial<HrRecord>, event = '更新记录'): HrRecord {
  const next = { ...previous, ...patch, fields: { ...previous.fields, ...normalizeIdentityFields(patch.fields || {}) }, history: [...previous.history] };
  const differences: string[] = [];
  for (const key of ['title', 'dept', 'owner', 'date'] as const) {
    if (previous[key] !== next[key]) differences.push(`${{ title: '名称', dept: '部门', owner: '负责人', date: '日期' }[key]}：${previous[key]} → ${next[key]}`);
  }
  for (const key of Object.keys(patch.fields || {})) {
    if (previous.fields[key] !== next.fields[key]) {
      const short = (value: string) => value?.length > 70 ? `${value.slice(0, 70)}…` : value || '未填写';
      differences.push(`${key}：${short(previous.fields[key])} → ${short(next.fields[key])}`);
    }
  }
  const criticalChanged = previous.title !== next.title || previous.dept !== next.dept || (criticalFields[moduleId] || []).some(k => previous.fields[k] !== next.fields[k]);
  if (moduleId === 'org' && previous.title !== next.title) next.fields['岗位课程标识'] = previous.fields['岗位课程标识'] || previous.title;
  if (moduleId === 'apply' && previous.status === '已确认' && differences.length) {
    next.status = '待核对';
    next.history.push('本次演示 · 登记资料或材料已变更，请重新核对确认。');
  }
  if (criticalFields[moduleId] && previous.status === '已批准' && criticalChanged) {
    next.status = '草稿';
    next.fields['审批版本'] = String(Number(previous.fields['审批版本'] || 1) + 1);
    next.fields['已审批 JD 初稿'] = '';
    next.history.push('本次演示 · 已批准的关键内容发生变更，已撤销批准，需重新审批。');
  }
  if (moduleId === 'account' && next.fields['入离职状态'] === '已离职' && next.status !== '已注销') {
    next.status = '待回收';
    next.fields['回收原因'] = '离职待回收';
  }
  if (moduleId === 'room' && (previous.date !== next.date || ['会议室', '开始时间', '结束时间'].some(key => previous.fields[key] !== next.fields[key]))) {
    if (previous.fields['使用开始'] || previous.fields['使用结束']) next.history.push(`本次演示 · 预约已调整，原使用记录：${previous.fields['使用开始'] || '未开始'} → ${previous.fields['使用结束'] || '未结束'}；新时段需重新登记使用。`);
    next.fields['使用开始'] = '';
    next.fields['使用结束'] = '';
  }
  if (moduleId === 'attendance' && previous.status === '已核对' && Object.keys(patch.fields || {}).some(k => k !== '核算依据' && previous.fields[k] !== next.fields[k])) next.status = '待核对';
  if (moduleId === 'expense' && previous.status === '已确认' && ['凭证金额', '发票金额', '报销金额', '发票号码'].some(k => previous.fields[k] !== next.fields[k])) next.status = '待复核';
  next.history.push(`本次演示 · ${event}${differences.length ? ` · ${differences.join('；')}` : ''}`);
  return next;
}

export function renameHrDepartment(state: HrState, previousName: string, nextName: string): HrState {
  return Object.fromEntries(Object.entries(state).map(([moduleId, rows]) => [moduleId, rows.map(row => ({
    ...row,
    dept: row.dept === previousName ? nextName : row.dept,
    fields: {
      ...row.fields,
      ...(moduleId === 'org' && row.fields['上级部门'] === previousName ? { '上级部门': nextName } : {}),
      ...(moduleId === 'learning' && row.fields['适用部门'] === previousName ? { '适用部门': nextName } : {}),
    },
  }))]));
}

export function ganttDateRanges(month: string) {
  if (!dateValid(`${month}-01`)) return [];
  const lastDate = new Date(`${month}-01T00:00:00Z`);
  lastDate.setUTCMonth(lastDate.getUTCMonth() + 1, 0);
  const lastDay = lastDate.getUTCDate();
  return Array.from({ length: Math.ceil(lastDay / 4) }, (_, index) => {
    const startDay = index * 4 + 1, endDay = Math.min(startDay + 3, lastDay);
    const timestamp = (day: number) => Date.parse(`${month}-${String(day).padStart(2, '0')}T00:00:00Z`);
    return { start: timestamp(startDay), end: timestamp(endDay), label: `${startDay === endDay ? startDay : `${startDay}–${endDay}`} 日` };
  });
}

function shiftedDate(value: string, cycle: string, anchor?: string): string {
  if (!dateValid(value)) throw new Error('任务日期无效。');
  const date = new Date(`${value}T00:00:00Z`);
  if (cycle === '每天' || cycle === '每周') date.setUTCDate(date.getUTCDate() + (cycle === '每天' ? 1 : 7));
  else {
    const day = Number(anchor || date.getUTCDate());
    date.setUTCDate(1);
    date.setUTCMonth(date.getUTCMonth() + ({ 每月: 1, 每季度: 3, 每年: 12 }[cycle] || 0));
    const last = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
    date.setUTCDate(Math.min(day, last));
  }
  return date.toISOString().slice(0, 10);
}
export function nextRecurringTask(row: HrRecord): Omit<HrRecord, 'id' | 'history'> {
  const cycle = row.fields['循环周期'];
  if (!recurrenceOptions.includes(cycle) || cycle === '不重复') throw new Error('请选择可重复的有效循环周期。');
  const start = row.fields['开始日期'] || row.date;
  if (!dateValid(start) || !dateValid(row.date)) throw new Error('任务日期无效。');
  if (start > row.date) throw new Error('开始日期不能晚于截止日期。');
  const duration = Date.parse(row.date) - Date.parse(start);
  const { id, history, ...copy } = row;
  const fields = { ...row.fields };
  delete fields['已生成下期'];
  delete fields['开始基准日'];
  fields['循环基准日'] ||= row.date.slice(8, 10);
  const date = shiftedDate(row.date, cycle, fields['循环基准日']);
  fields['开始日期'] = new Date(Date.parse(date) - duration).toISOString().slice(0, 10);
  fields['上期任务编号'] = row.id;
  return { ...copy, date, status: '待开始', fields };
}

const ids = (value = '') => value.split(/[\s,，;；]+/).filter(Boolean);
export function scopeHrRows(moduleId: string, rows: HrRecord[], role: string, employeeId: string, department: string): HrRecord[] {
  if (role === '人力负责人' || role === '员工关系岗' || role === '总经理') return rows;
  const employeeScoped = ['archive', 'collect', 'attendance', 'account', 'performance', 'probation', 'approval'];
  if (role === '员工本人' && employeeScoped.includes(moduleId)) {
    return rows.filter(r => moduleId === 'approval'
      ? [r.fields['申请人编号'], r.fields['抄送人员编号'], r.fields['共享人员编号'], r.fields['代操作人员编号']].some(value => ids(value).includes(employeeId))
      : r.fields['人员编号'] === employeeId || (moduleId === 'archive' && r.id === employeeId));
  }
  if (role === '部门负责人' && ['req01', 'resume', 'apply', 'interview', 'assess', 'offer', ...employeeScoped].includes(moduleId)) return rows.filter(r => r.dept === department);
  return rows;
}

export function isHrRole(role: string) { return role === '人力负责人' || role === '员工关系岗'; }
export function canManageModule(moduleId: string, role: string) {
  if (isHrRole(role)) return true;
  if (['room', 'meeting', 'tasks', 'expense'].includes(moduleId)) return true;
  if (role === '部门负责人' && ['req01', 'probation', 'position', 'spec'].includes(moduleId)) return true;
  return false;
}
