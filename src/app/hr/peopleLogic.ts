import type { HrRecord } from '../../mocks/hrPreview';

export const personId = (row: HrRecord) => row.fields['人员编号'] || (/^E-/.test(row.id) ? row.id : '');
export function safetyDepartment(value: string) {
  return ['研发', '运营', '供应链', '生产', '质量'].find(name => value?.includes(name)) || '运营';
}
export const isHr = (role: string) => ['人力负责人', '员工关系岗'].includes(role);
export const validScore = (value: string) => value.trim() !== '' && Number.isFinite(Number(value)) && Number(value) >= 0 && Number(value) <= 100;
export function readJson<T>(value: string, fallback: T): T { try { return value ? JSON.parse(value) as T : fallback; } catch { return fallback; } }

export type ProbationStage = { goal: string; plan: string; progress: string; self: string; feedback: string; status: string; attachment?: string };
const emptyStage = (): ProbationStage => ({ goal: '', plan: '', progress: '', self: '', feedback: '', status: '待自评' });
function probationStages(row: HrRecord): Record<string, ProbationStage> {
  const stages = readJson<Record<string, ProbationStage>>(row.fields['阶段记录'], {});
  const initial = row.fields['考核阶段'] || '30 天';
  if (!stages[initial]) stages[initial] = { goal: row.fields['阶段目标'] || '', plan: row.fields['计划任务'] || '', progress: row.fields['完成情况'] || '', self: row.fields['自评'] || '', feedback: row.fields['上级反馈'] || '', status: row.status, attachment: row.fields['任务书'] || '' };
  return stages;
}
export const probationStage = (row: HrRecord, stage: string): ProbationStage => probationStages(row)[stage] || emptyStage();
export const probationStageOrder = ['30 天', '60 天', '90 天'];
export function canEditProbationStage(row: HrRecord, stage: string) {
  const index = probationStageOrder.indexOf(stage);
  return index >= 0 && probationStageOrder.slice(0, index).every(previous => probationStage(row, previous).status === '已评议');
}
export const probationComplete = (row: HrRecord) => probationStageOrder.every(stage => probationStage(row, stage).status === '已评议');
export function saveProbationStage(row: HrRecord, stage: string, value: ProbationStage): Partial<HrRecord> {
  const stages = { ...probationStages(row), [stage]: value };
  return { status: value.status, fields: { ...row.fields, '考核阶段': stage, '阶段记录': JSON.stringify(stages), '阶段目标': value.goal, '计划任务': value.plan, '完成情况': value.progress, '自评': value.self, '上级反馈': value.feedback, '任务书': value.attachment || '' } };
}

export function canScore(row: HrRecord, step: 'self' | 'manager' | 'gm', role: string, employeeId: string) {
  if (step === 'self') return row.status === '待自评' && role === '员工本人' && personId(row) === employeeId;
  if (step === 'manager') return row.status === '待上级评' && role === '部门负责人';
  return row.status === '待总经理评' && role === '总经理';
}
export function newPerformanceRecord(person: HrRecord, month: string): Omit<HrRecord, 'id' | 'history'> {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new Error('请选择有效考核月份');
  return { title: person.title, dept: person.dept, owner: person.owner, status: '待自评', date: `${month}-28`, detail: '月度考核会话记录', fields: { '人员编号': personId(person), '考核月份': month, '考核目标': '', '自评分': '', '上级评分': '', '总经理评分': '', '考勤扣分建议': '0', '扣分校准': '0', '校准依据': '', '维度配置': JSON.stringify(defaultDimensions), '扣分规则': '迟到每次 1 分；无故缺勤每小时 1 分（演示口径，须正式确认）', '每小时扣分': '1', '扣分上限': '10' } };
}
export type PerformanceImport = { person: string; goal: string; score: string };
export function performanceImportPlan(input: PerformanceImport[], month: string, people: HrRecord[], records: HrRecord[], role: string, employeeId: string) {
  if (!input.length) throw new Error('没有可导入记录');
  const seen = new Set<string>();
  return input.map((item, i) => {
    const matches = people.filter(p => personId(p) === item.person || p.title === item.person);
    if (matches.length !== 1) throw new Error(`第 ${i + 2} 行：人员编号或姓名不在可见花名册内，或姓名不唯一`);
    const person = matches[0], id = personId(person);
    if (!id || seen.has(id)) throw new Error(`第 ${i + 2} 行：人员编号重复或缺失`);
    seen.add(id);
    if (!(isHr(role) || (role === '员工本人' && employeeId === id))) throw new Error('当前角色不能导入该员工自评');
    if (!item.goal.trim() || !validScore(item.score)) throw new Error(`第 ${i + 2} 行：目标必填，自评分须为 0–100`);
    const existing = records.find(r => personId(r) === id && r.fields['考核月份'] === month);
    if (existing && existing.status !== '待自评') throw new Error(`第 ${i + 2} 行：当前评分阶段不可导入；请由 HR 退回自评后操作`);
    const record = existing ? { ...existing } : newPerformanceRecord(person, month);
    return { existingId: existing?.id, record: { ...record, status: '待上级评', fields: { ...record.fields, '考核目标': item.goal.trim(), '自评分': item.score, '上级评分': '', '总经理评分': '' } } };
  });
}
export type Dimension = { name: string; weight: number };
export const defaultDimensions: Dimension[] = [{ name: '目标交付', weight: 50 }, { name: '工作质量', weight: 30 }, { name: '协作成长', weight: 20 }];
export function validateDimensions(rows: Dimension[]) {
  if (!rows.length || rows.some(r => !r.name.trim() || !Number.isFinite(r.weight) || r.weight <= 0) || new Set(rows.map(r => r.name.trim())).size !== rows.length) return '维度名称必须唯一，权重必须大于 0';
  if (Math.abs(rows.reduce((n, r) => n + r.weight, 0) - 100) > .001) return '各维度权重合计必须为 100%';
  return '';
}
export function attendanceDeduction(verifiedHours: number, perHour: number, cap: number) {
  if ([verifiedHours, perHour, cap].some(n => !Number.isFinite(n) || n < 0)) throw new Error('核实小时、每小时扣分与上限须为不小于 0 的数字');
  return Number(Math.min(verifiedHours * perHour, cap).toFixed(2));
}

// Actual attendance is an editable total. A manual correction replaces that total,
// so remove the previously applied adjustment before reconciling it again.
export function attendanceBaseDays(fields: Record<string, string>) {
  const current = Number(fields['实际出勤天数']);
  if (!fields['对账前出勤天数']?.trim()) return current;
  const base = Number(fields['对账前出勤天数']);
  const previousDifference = Number(fields['差异修正小时'] || '0');
  const previousHours = Number(fields['每日折算小时'] || '8');
  if (![current, base, previousDifference, previousHours].every(Number.isFinite) || previousHours <= 0) return NaN;
  const previousTotal = Number((base + previousDifference / previousHours).toFixed(3));
  return current === previousTotal ? base : Number((current - previousDifference / previousHours).toFixed(3));
}

export type AttendanceLine = { id: string; date: string; access: number; approval: number; adopted: number; basis: string; approvalId?: string; event?: string };
export function reconcileAttendance(lines: AttendanceLine[], hoursPerDay: number) {
  if (!Number.isFinite(hoursPerDay) || hoursPerDay <= 0 || hoursPerDay > 24) throw new Error('每天折算小时须大于 0 且不超过 24');
  if (!lines.length) throw new Error('至少需要一条考勤对账记录');
  if (lines.some(r => [r.access, r.approval, r.adopted].some(v => !Number.isFinite(v) || v < 0 || v > 24))) throw new Error('每日门禁、审批和采用小时须在 0–24 范围');
  if (lines.some(r => !r.basis.trim())) throw new Error('每条记录必须填写采用依据');
  const hours = lines.reduce((n, r) => n + r.adopted, 0);
  return { hours, days: Number((hours / hoursPerDay).toFixed(3)), difference: lines.reduce((n, r) => n + r.adopted - r.access, 0) };
}

export function personCourses(records: HrRecord[], person: HrRecord, departments: HrRecord[] = []): HrRecord[] {
  const id = personId(person);
  const templates = records.filter(r => !r.fields['人员编号'] && (r.fields['适用部门'] === '全部' || r.fields['适用部门'] === person.dept));
  const courseDepartment = departments.find(department => department.title === person.dept)?.fields['岗位课程标识'] || person.dept;
  const production = courseDepartment === '生产部';
  const subjects = production ? ['现场安全与标准作业', '工艺执行与异常处置', '独立上岗与质量复盘'] : courseDepartment === '研发注册部' ? ['设计输入与验证规范', '样机验证与风险记录', '独立项目评审与复盘'] : ['岗位流程与安全要求', '岗位实务与协作', '独立交付与复盘'];
  const derived = subjects.map((title, i): HrRecord => ({ id: `JOB-${courseDepartment}-${i + 1}`, title, dept: person.dept, owner: person.owner, status: '未开始', date: person.date, detail: '岗位专属课程演示，正式内容待部门确认', history: [], fields: { '适用部门': person.dept, '课程阶段': '新员工', '学习周期': `第 ${i + 1} 个月`, '最多考试次数': '3', '岗位课程':'是', '课程摘要': `${person.fields['岗位'] || person.dept}：${title}。围绕实际岗位交付保留过程记录、核对事实、完成责任人确认。` } }));
  const courses = [...templates.filter(r => r.fields['课程阶段'] === '新员工'), ...derived, ...templates.filter(r => r.fields['课程阶段'] !== '新员工')];
  return courses.map(template => {
    const progress = records.find(r => r.fields['人员编号'] === id && r.fields['课程编号'] === template.id);
    return { ...template, ...progress, fields: { ...template.fields, ...progress?.fields, '人员编号': id, '课程编号': template.id, '进度记录编号': progress?.id || '' } };
  });
}
