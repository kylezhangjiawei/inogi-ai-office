import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import ts from 'typescript';

const source = await fs.readFile(new URL('../src/app/hr/peopleLogic.ts', import.meta.url), 'utf8').catch(() => 'export {}');
const js = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText;
const logic = await import(`data:text/javascript;base64,${Buffer.from(js).toString('base64')}`);
const row = (id, fields = {}, other = {}) => ({ id, title: '员工 A', dept: '研发注册部', owner: '林序', status: '待自评', date: '2026-10-16', detail: '', history: [], fields: { '人员编号': 'E-001', ...fields }, ...other });

test('试用期保存 60 天不能覆盖 30 天，切回后仍能继续编辑', () => {
  assert.equal(typeof logic.saveProbationStage, 'function');
  const a = row('PR-1', { '考核阶段': '30 天', '阶段目标': '熟悉流程', '完成情况': '已完成' });
  const b = { ...a, ...logic.saveProbationStage(a, '60 天', { goal: '独立验证', plan: '完成试验', progress: '50%', self: '', feedback: '', status: '待自评' }) };
  assert.equal(logic.probationStage(b, '30 天').progress, '已完成');
  assert.equal(logic.probationStage(b, '60 天').goal, '独立验证');
  assert.equal(logic.probationStage(b, '90 天').self, '');
});
test('新月份导入建立缺失人员且同月以编号更新，不复制旧月评分', () => {
  assert.equal(typeof logic.performanceImportPlan, 'function');
  const people = [row('E-001')];
  const records = [row('PF-1', { '考核月份': '2026-10', '自评分': '90' })];
  const result = logic.performanceImportPlan([{ person: 'E-001', goal: '新目标', score: '88' }], '2026-11', people, records, '人力负责人', 'E-001');
  assert.equal(result[0].existingId, undefined);
  assert.equal(result[0].record.fields['考核月份'], '2026-11');
  assert.equal(result[0].record.fields['上级评分'], '');
  const update = logic.performanceImportPlan([{ person: '员工 A', goal: '更新目标', score: '82' }], '2026-10', people, records, '人力负责人', 'E-001');
  assert.equal(update[0].existingId, 'PF-1');
});
test('绩效严格阶段与人员角色：不能替其他员工自评或跳过上级', () => {
  assert.equal(typeof logic.canScore, 'function');
  const a = row('PF-1');
  assert.equal(logic.canScore(a, 'self', '员工本人', 'E-002'), false);
  assert.equal(logic.canScore(a, 'self', '员工本人', 'E-001'), true);
  assert.equal(logic.canScore(a, 'manager', '部门负责人', 'E-001'), false);
  assert.equal(logic.canScore({ ...a, status: '待上级评' }, 'manager', '部门负责人', 'E-001'), true);
  assert.equal(logic.canScore({ ...a, status: '待总经理评' }, 'gm', '总经理', 'E-001'), true);
  assert.throws(() => logic.performanceImportPlan([{ person: 'E-001', goal: '修改', score: '80' }], '2026-10', [row('E-001')], [row('PF-1', { '考核月份': '2026-10' }, { status: '待总经理评' })], '人力负责人', 'E-001'), /阶段/);
});
test('考勤必须逐条选定依据，小时与半天折算保留差额，拒绝负值', () => {
  assert.equal(typeof logic.reconcileAttendance, 'function');
  const source = [{ id: 'D1', date: '2026-10-08', access: 4, approval: 8, adopted: 8, basis: '批准的外勤申请' }];
  const result = logic.reconcileAttendance(source, 8);
  assert.equal(result.hours, 8);
  assert.equal(result.days, 1);
  assert.equal(result.difference, 4);
  assert.throws(() => logic.reconcileAttendance([{ ...source[0], adopted: -1 }], 8), /小时/);
  assert.throws(() => logic.reconcileAttendance([{ ...source[0], basis: '' }], 8), /依据/);
  assert.throws(() => logic.reconcileAttendance(source, 0), /折算/);
});
test('学习成绩按人员编号隔离，生产员工拥有三个月岗位课程', () => {
  assert.equal(typeof logic.personCourses, 'function');
  const template = row('L-1', { '人员编号': '', '适用部门': '全部', '课程阶段': '新员工', '学习周期': '第 1 周' }, { title: '入职通识', status: '未开始' });
  const progress = row('LP-1', { '课程编号': 'L-1', '考试成绩': '100' }, { status: '已通过' });
  const a = logic.personCourses([template, progress], row('E-001'));
  const b = logic.personCourses([template, progress], row('E-002', { '人员编号': 'E-002', '岗位': '生产技术员' }, { dept: '生产部', title: '员工 B' }));
  assert.equal(a[0].status, '已通过');
  assert.equal(b[0].status, '未开始');
  assert.equal(b.filter(r => r.fields['课程阶段'] === '新员工' && r.fields['适用部门'] === '生产部').length, 3);
});
test('扣分规则按核实小时及上限计算，拒绝无依据的负数输入', () => {
  assert.equal(typeof logic.attendanceDeduction, 'function');
  assert.equal(logic.attendanceDeduction(4, 1.5, 10), 6);
  assert.equal(logic.attendanceDeduction(12, 1.5, 10), 10);
  assert.throws(() => logic.attendanceDeduction(-1, 1, 10), /不小于 0/);
});
test('导入全表验证阻止重复编号和越权员工，不生成部分结果', () => {
  assert.throws(() => logic.performanceImportPlan([{ person: 'E-001', goal: '目标', score: '85' }, { person: 'E-001', goal: '另一目标', score: '85' }], '2026-11', [row('E-001')], [], '人力负责人', 'E-001'), /重复/);
  assert.throws(() => logic.performanceImportPlan([{ person: 'E-001', goal: '目标', score: '85' }], '2026-11', [row('E-001')], [], '员工本人', 'E-002'), /角色/);
  assert.throws(() => logic.performanceImportPlan([{ person: 'E-001', goal: '目标', score: '101' }], '2026-11', [row('E-001')], [], '人力负责人', 'E-001'), /0–100/);
});
test('外部归档未知安全部门回退到规范模板，不产生未定义卡片', () => {
  assert.equal(typeof logic.safetyDepartment, 'function');
  assert.equal(logic.safetyDepartment('销售/职能'), '运营');
  assert.equal(logic.safetyDepartment('质量部'), '质量');
  assert.equal(logic.safetyDepartment('生产'), '生产');
});
test('试用期不可跳过前置评议，只有90天已评议不构成全阶段完成', () => {
  assert.equal(typeof logic.canEditProbationStage, 'function');
  const a = row('PR-1', { '考核阶段': '60 天' });
  assert.equal(logic.canEditProbationStage(a, '30 天'), true);
  assert.equal(logic.canEditProbationStage(a, '60 天'), false);
  assert.equal(logic.canEditProbationStage(a, '90 天'), false);
  const finished = { goal: '目标', plan: '计划', progress: '完成', self: '完成', feedback: '通过', status: '已评议' };
  const b = { ...a, ...logic.saveProbationStage(a, '30 天', finished) };
  assert.equal(logic.canEditProbationStage(b, '60 天'), true);
  assert.equal(logic.canEditProbationStage(b, '90 天'), false);
  const c = { ...b, ...logic.saveProbationStage(b, '90 天', finished) };
  assert.equal(logic.probationComplete(c), false);
  const d = { ...c, ...logic.saveProbationStage(c, '60 天', finished) };
  assert.equal(logic.probationComplete(d), true);
});


test('手工修正总出勤后重置对账基准，重复确认不会累计或覆盖修正', () => {
  const original = { '实际出勤天数': '20.625', '对账前出勤天数': '20', '差异修正小时': '5', '每日折算小时': '8' };
  assert.equal(logic.attendanceBaseDays(original), 20);
  const corrected = { ...original, '实际出勤天数': '18' };
  assert.equal(logic.attendanceBaseDays(corrected), 17.375);
  const saved = { ...corrected, '对账前出勤天数': String(logic.attendanceBaseDays(corrected)) };
  assert.equal(logic.attendanceBaseDays(saved), 17.375);
  assert.equal(logic.attendanceBaseDays(saved) + 5 / 8, 18);
  assert.equal(logic.attendanceBaseDays({ '实际出勤天数': '20' }), 20);
  assert.ok(Number.isNaN(logic.attendanceBaseDays({ ...saved, '每日折算小时': '0' })));
});


test('部门改名保留岗位课程标识与成绩，实际调部门使用新部门课程', () => {
  const employee = row('E-001', {}, { dept: '研发技术部' });
  const department = row('ORG-1', { '岗位课程标识': '研发注册部' }, { title: '研发技术部' });
  const progress = row('LP-1', { '课程编号': 'JOB-研发注册部-1', '考试成绩': '100' }, { title: '设计输入与验证规范', status: '已通过' });
  const courses = logic.personCourses([progress], employee, [department]);
  assert.equal(courses[0].fields['课程编号'], 'JOB-研发注册部-1');
  assert.equal(courses[0].title, '设计输入与验证规范');
  assert.equal(courses[0].status, '已通过');
  const transferred = logic.personCourses([progress], { ...employee, dept: '生产部' }, [department]);
  assert.equal(transferred[0].fields['课程编号'], 'JOB-生产部-1');
  assert.equal(transferred[0].status, '未开始');
});
