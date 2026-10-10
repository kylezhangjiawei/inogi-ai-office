import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(new URL('../package.json', import.meta.url));
const ts = require('typescript');
const ui = new Proxy({}, { get: (_, key) => String(key) });
function load(file, extra = '', hook = () => { throw new Error('hook outside render'); }) {
  const source = fs.readFileSync(new URL('../src/app/hr/' + file, import.meta.url), 'utf8') + extra;
  const js = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const module = { exports: {} };
  const localRequire = (name) => name === 'react' ? { useState: hook } : name === 'react/jsx-runtime' || name === 'exceljs' ? require(name) : name === 'react-router' ? { Link: 'Link', useSearchParams: () => [new URLSearchParams()] } : name === './peopleLogic' ? people : name === './LearningViews' ? { scopedPeople: p => p.all.archive } : ui;
  new Function('require', 'module', 'exports', js)(localRequire, module, module.exports);
  return module.exports;
}
const people = load('peopleLogic.ts');
const row = (id, fields = {}, extra = {}) => ({ id, title: '员工 A', dept: '研发注册部', owner: '林序', status: '待总经理评', date: '2026-10-16', detail: '', history: [], fields: { '人员编号': 'E-001', ...fields }, ...extra });
function harness(file, exported) {
  const values = []; let index = 0;
  const hooks = initial => { const current = index++; if (!(current in values)) values[current] = typeof initial === 'function' ? initial() : initial; return [values[current], value => { values[current] = typeof value === 'function' ? value(values[current]) : value; }]; };
  const component = load(file, `\nexport { ${exported} };`, hooks)[exported];
  return props => { index = 0; return component(props); };
}
function nodes(node) { return !node || typeof node !== 'object' ? [] : Array.isArray(node) ? node.flatMap(nodes) : [node, ...nodes(node.props?.children)]; }
function content(node) { return Array.isArray(node) ? node.map(content).join('') : typeof node === 'string' || typeof node === 'number' ? String(node) : node && typeof node === 'object' ? content(node.props?.children) : ''; }

test('绩效输入负数核实缺勤小时后，保存校准须禁用或拒绝', () => {
  const render = harness('PerformanceViews.tsx', 'PerformanceDetail');
  const updates = [];
  const record = row('PF-001', { '考核月份': '2026-10', '扣分校准': '0', '校准依据': '已核对', '核实无故缺勤小时': '0' });
  const p = { role: '人力负责人', employeeId: 'E-001', all: { performance: [record], attendance: [] }, update: (...args) => updates.push(args) };
  let tree = render({ p, row: record });
  const label = nodes(tree).find(node => node.type === 'label' && content(node).startsWith('核实无故缺勤小时'));
  nodes(label).find(node => node.type === 'Input').props.onChange({ target: { value: '-1' } });
  tree = render({ p, row: record });
  const button = nodes(tree).find(node => node.type === 'Button' && content(node) === '保存扣分校准');
  if (!button.props.disabled) button.props.onClick();
  assert.equal(updates.length, 0, 'UI permits saving 核实无故缺勤小时=-1');
});

test('学习设置重新打开应回填个人已保存的5次考试上限', () => {
  const render = harness('LearningViews.tsx', 'Learning');
  const person = row('E-001');
  const template = row('L-001', { '人员编号': '', '适用部门': '全部', '课程阶段': '新员工', '最多考试次数': '3' }, { status: '未开始' });
  const progress = row('LP-001', { '课程编号': 'L-001', '最多考试次数': '5' }, { status: '未开始' });
  const tree = render({ p: { role: '人力负责人', employeeId: 'E-001', all: { archive: [person], learning: [template, progress] } } });
  const label = nodes(tree).find(node => node.type === 'label' && content(node).startsWith('该员工最多考试次数'));
  assert.equal(nodes(label).find(node => node.type === 'Input').props.value, '5');
});


test('已对账考勤被人工修改总出勤后，重新确认不得恢复旧总数', () => {
  const render = harness('PeopleRecords.tsx', 'AttendanceDetail');
  const updates = [];
  const record = row('AT-001', { '实际出勤天数': '18', '对账前出勤天数': '20', '差异修正小时': '5', '每日折算小时': '8', '核算依据': '补充核对后的总出勤', '逐条对账': JSON.stringify([{ id: 'D1', date: '2026-10-07', access: 4, approval: 8, adopted: 8, basis: '批准外勤' }, { id: 'D2', date: '2026-10-08', access: 7, approval: 8, adopted: 8, basis: '补卡确认' }]) }, { status: '待核对' });
  const p = { role: '人力负责人', all: { approval: [] }, update: (...args) => updates.push(args) };
  const tree = render({ p, row: record });
  nodes(tree).find(node => node.type === 'Button' && content(node) === '确认核对').props.onClick();
  assert.equal(updates[0][1].fields['实际出勤天数'], '18');
});


test('考试次数草稿按员工与课程隔离，切换人员不带入其他人的设置', () => {
  const render = harness('LearningViews.tsx', 'Learning');
  const a = row('E-001'), b = row('E-002', { '人员编号': 'E-002' }, { title: '员工 B', dept: '生产部' });
  const template = row('L-001', { '人员编号': '', '适用部门': '全部', '课程阶段': '新员工', '最多考试次数': '3' }, { status: '未开始' });
  const progress = row('LP-001', { '课程编号': 'L-001', '最多考试次数': '5' }, { status: '未开始' });
  const props = { p: { role: '人力负责人', employeeId: 'E-001', all: { archive: [a, b], learning: [template, progress] } } };
  const limit = tree => nodes(nodes(tree).find(node => node.type === 'label' && content(node).startsWith('该员工最多考试次数'))).find(node => node.type === 'Input');
  const picker = tree => nodes(tree).find(node => node.type === 'NativeSelect' && node.props['aria-label'] === '学习对象');
  let tree = render(props);
  limit(tree).props.onChange({ target: { value: '6' } });
  picker(tree).props.onChange({ target: { value: 'E-002' } });
  tree = render(props);
  assert.equal(limit(tree).props.value, '3');
  picker(tree).props.onChange({ target: { value: 'E-001' } });
  tree = render(props);
  assert.equal(limit(tree).props.value, '6');
});


test('绩效无效缺勤小时显示关联到输入的就地错误，修正后消失', () => {
  const render = harness('PerformanceViews.tsx', 'PerformanceDetail');
  const record = row('PF-001', { '考核月份': '2026-10', '扣分校准': '0', '校准依据': '已核对', '核实无故缺勤小时': '0' });
  const props = { p: { role: '人力负责人', employeeId: 'E-001', all: { performance: [record], attendance: [] } }, row: record };
  const hours = tree => nodes(nodes(tree).find(node => node.type === 'label' && content(node).startsWith('核实无故缺勤小时'))).find(node => node.type === 'Input');
  let tree = render(props); hours(tree).props.onChange({ target: { value: '-1' } }); tree = render(props);
  assert.equal(hours(tree).props['aria-invalid'], true);
  assert.ok(nodes(tree).some(node => node.props?.id === hours(tree).props['aria-describedby'] && /不小于 0/.test(content(node))));
  hours(tree).props.onChange({ target: { value: '2' } }); tree = render(props);
  assert.notEqual(hours(tree).props['aria-invalid'], true);
});

test('学习上限说明范围和已考次数，保存后在课程内反馈', () => {
  const render = harness('LearningViews.tsx', 'Learning');
  const person = row('E-001');
  const template = row('L-001', { '人员编号': '', '适用部门': '全部', '课程阶段': '新员工', '最多考试次数': '3' }, { status: '未开始' });
  const progress = row('LP-001', { '课程编号': 'L-001', '最多考试次数': '5', '已考次数': '2' }, { status: '学习中' });
  const updates = [];
  const props = { p: { role: '人力负责人', employeeId: 'E-001', all: { archive: [person], learning: [template, progress] }, updateModule: (...args) => updates.push(args) } };
  const limit = tree => nodes(nodes(tree).find(node => node.type === 'label' && content(node).startsWith('该员工最多考试次数'))).find(node => node.type === 'Input');
  let tree = render(props); limit(tree).props.onChange({ target: { value: '1' } }); tree = render(props);
  assert.equal(limit(tree).props['aria-invalid'], true);
  assert.ok(nodes(tree).some(node => node.props?.role === 'alert' && /已考.*2/.test(content(node))));
  limit(tree).props.onChange({ target: { value: '3' } }); tree = render(props);
  nodes(tree).find(node => node.type === 'Button' && content(node) === '保存设置').props.onClick();
  tree = render(props);
  assert.equal(updates.length, 1);
  assert.ok(nodes(tree).some(node => node.props?.role === 'status' && /已保存.*3/.test(content(node))));
});

test('考勤清空小时输入显示空值与就地错误，不渲染NaN差异', () => {
  const render = harness('PeopleRecords.tsx', 'AttendanceDetail');
  const props = { p: { role: '人力负责人', all: { approval: [] } }, row: row('AT-001', { '实际出勤天数': '20', '核算依据': '旧依据' }, { status: '待核对' }) };
  let tree = render(props);
  const access = view => nodes(nodes(view).find(node => node.type === 'label' && content(node).startsWith('门禁小时'))).find(node => node.type === 'Input');
  access(tree).props.onChange({ target: { value: '' } }); tree = render(props);
  assert.equal(access(tree).props.value, '');
  assert.equal(access(tree).props['aria-invalid'], true);
  assert.doesNotMatch(content(tree), /NaN/);
  assert.ok(nodes(tree).some(node => node.props?.role === 'alert' && /0.*24/.test(content(node))));
});


test('试用期保存计划保留自评草稿与原反馈，员工反馈与后续阶段仍锁定', () => {
  const render = harness('LearningViews.tsx', 'ProbationDetail');
  const record = row('PR-001', { '考核阶段': '30 天', '阶段目标': '熟悉岗位', '计划任务': '完成资料整理', '完成情况': '已完成', '上级反馈': '经理原有记录' }, { status: '待自评' });
  const updates = [], props = { p: { role: '员工本人', employeeId: 'E-001', all: { archive: [], learning: [], org: [] }, update: (...args) => updates.push(args) }, row: record };
  const field = (tree, label) => nodes(tree).find(n => n.type === 'Textarea' && n.props['aria-label'] === label);
  const button = (tree, text) => nodes(tree).find(n => n.type === 'Button' && content(n) === text);
  let tree = render(props);
  field(tree, '完成情况自评').props.onChange({ target: { value: '已完成资料归档，后续优化交接' } });
  tree = render(props);
  assert.equal(field(tree, '上级沟通反馈').props.disabled, true);
  assert.equal(button(tree, '保存上级反馈').props.disabled, true);
  button(tree, '保存本阶段计划 / 完成情况').props.onClick();
  assert.equal(updates[0][1].fields['自评'], '已完成资料归档，后续优化交接');
  assert.equal(updates[0][1].fields['上级反馈'], '经理原有记录');
  tree = render({ ...props, row: { ...record, ...updates[0][1] } });
  assert.equal(field(tree, '完成情况自评').props.value, '已完成资料归档，后续优化交接');
  nodes(tree).find(n => n.type === 'ViewSwitch').props.onChange('60 天');
  tree = render(props);
  assert.equal(field(tree, '完成情况自评').props.disabled, true);
  assert.equal(button(tree, '保存本阶段计划 / 完成情况').props.disabled, true);
  button(tree, '提交阶段自评').props.onClick();
  assert.equal(updates.length, 1, '前置阶段未评议时不得写入后续阶段');
});

test('试用期三种操作的错误关联当前按钮，修改及切阶段后清除且不写入无效资料', () => {
  for (const item of [
    { role: '人力负责人', status: '待自评', button: '保存本阶段计划 / 完成情况', edit: '阶段目标', fields: {} },
    { role: '员工本人', status: '待自评', button: '提交阶段自评', edit: '完成情况自评', fields: { '阶段目标': '目标', '计划任务': '计划' } },
    { role: '人力负责人', status: '待上级反馈', button: '保存上级反馈', edit: '上级沟通反馈', fields: { '阶段目标': '目标', '计划任务': '计划' } },
  ]) {
    const render = harness('LearningViews.tsx', 'ProbationDetail'), updates = [];
    const props = { p: { role: item.role, employeeId: 'E-001', all: { archive: [], learning: [], org: [] }, update: (...args) => updates.push(args) }, row: row('PR-001', { '考核阶段': '30 天', ...item.fields }, { status: item.status }) };
    const button = tree => nodes(tree).find(n => n.type === 'Button' && content(n) === item.button);
    let tree = render(props); button(tree).props.onClick(); tree = render(props);
    let alerts = nodes(tree).filter(n => n.props?.role === 'alert');
    assert.equal(alerts.length, 1);
    assert.ok(alerts[0].props.id && button(tree).props['aria-describedby'] === alerts[0].props.id, item.button + ' must describe its own error');
    assert.equal(updates.length, 0);
    nodes(tree).find(n => n.type === 'Textarea' && n.props['aria-label'] === item.edit).props.onChange({ target: { value: '补充说明' } });
    tree = render(props); assert.equal(nodes(tree).filter(n => n.props?.role === 'alert').length, 0);
    nodes(tree).find(n => n.type === 'Textarea' && n.props['aria-label'] === item.edit).props.onChange({ target: { value: '' } });
    tree = render(props); button(tree).props.onClick(); tree = render(props);
    assert.equal(nodes(tree).filter(n => n.props?.role === 'alert').length, 1);
    nodes(tree).find(n => n.type === 'ViewSwitch').props.onChange('60 天'); tree = render(props);
    assert.equal(nodes(tree).filter(n => n.props?.role === 'alert').length, 0);
  }
});

test('绩效评分错误紧邻评分按钮，编辑后清除并保留阶段权限', () => {
  for (const item of [{ role: '员工本人', status: '待自评', button: '保存自评', input: '自评分' }, { role: '部门负责人', status: '待上级评', button: '保存上级评', input: '上级评分' }]) {
    const render = harness('PerformanceViews.tsx', 'PerformanceDetail'), updates = [];
    const props = { p: { role: item.role, employeeId: 'E-001', all: { performance: [], attendance: [] }, update: (...args) => updates.push(args) }, row: row('PF-001', { '考核目标': '目标' }, { status: item.status }) };
    const button = tree => nodes(tree).find(n => n.type === 'Button' && content(n) === item.button);
    let tree = render(props); button(tree).props.onClick(); tree = render(props);
    const alert = nodes(tree).find(n => n.props?.role === 'alert');
    assert.ok(alert?.props.id && button(tree).props['aria-describedby'] === alert.props.id);
    assert.ok(nodes(tree).indexOf(alert) < nodes(tree).findIndex(n => n.type === 'h3' && content(n) === '考勤扣分校准'));
    assert.equal(updates.length, 0);
    const field = nodes(nodes(tree).find(n => n.type === 'label' && content(n) === item.input)).find(n => n.type === 'Input');
    assert.equal(field.props.disabled, false);
    field.props.onChange({ target: { value: '85' } }); tree = render(props);
    assert.equal(nodes(tree).filter(n => n.props?.role === 'alert').length, 0);
  }
});

test('绩效配置错误留在配置保存区，修正和切月清除，导入错误仍在导入区', async () => {
  const render = harness('PerformanceViews.tsx', 'Performance'), updates = [];
  const record = row('PF-001', { '考核月份': '2026-10' }, { status: '待自评' });
  const p = { role: '人力负责人', employeeId: 'E-001', rows: [record], all: { archive: [], performance: [record], attendance: [] }, update: (...args) => updates.push(args), notify: () => {} };
  const input = (tree, label) => nodes(tree).find(n => n.type === 'Input' && n.props['aria-label'] === label);
  const save = tree => nodes(tree).find(n => n.type === 'Button' && content(n) === '保存本月配置');
  let tree = render({ p }); input(tree, '目标交付权重百分比').props.onChange({ target: { value: '90' } });
  tree = render({ p }); save(tree).props.onClick(); tree = render({ p });
  const details = nodes(tree).find(n => n.type === 'details');
  const alert = nodes(details).find(n => n.props?.role === 'alert');
  assert.ok(alert, 'configuration validation must render inside the expanded configuration');
  assert.ok(alert.props.id && save(tree).props['aria-describedby'] === alert.props.id);
  assert.equal(updates.length, 0);
  input(tree, '目标交付权重百分比').props.onChange({ target: { value: '50' } }); tree = render({ p });
  assert.equal(nodes(tree).filter(n => n.props?.role === 'alert').length, 0);
  input(tree, '考核月份').props.onChange({ target: { value: '2026-11' } }); tree = render({ p });
  save(tree).props.onClick(); tree = render({ p }); assert.match(content(nodes(tree).find(n => n.props?.role === 'alert')), /尚无记录/);
  input(tree, '考核月份').props.onChange({ target: { value: '2026-10' } }); tree = render({ p });
  assert.equal(nodes(tree).filter(n => n.props?.role === 'alert').length, 0);
  input(tree, '导入 Excel 自评文件').props.onChange({ target: { files: [{ size: 6 * 1024 * 1024 }], value: 'large.xlsx' } });
  await new Promise(resolve => setImmediate(resolve)); tree = render({ p });
  assert.match(content(nodes(tree).find(n => n.props?.role === 'alert')), /5 MB/);
  assert.equal(nodes(nodes(tree).find(n => n.type === 'details')).filter(n => n.props?.role === 'alert').length, 0);
});

test('绩效导入刷新受影响详情，未导入员工的在编校准草稿保留', { timeout: 4000 }, async () => {
  const render = harness('PerformanceViews.tsx', 'Performance');
  const a = row('PF-001', { '考核月份': '2026-10', '考核目标': '原目标', '自评分': '' }, { status: '待自评' });
  const b = row('PF-002', { '人员编号': 'E-002', '考核月份': '2026-10' }, { title: '员工 B', status: '待自评' });
  let finish; const completed = new Promise(resolve => { finish = resolve; });
  const p = { role: '人力负责人', employeeId: 'E-001', rows: [a, b], all: { archive: [row('E-001'), row('E-002', { '人员编号': 'E-002' }, { title: '员工 B' })], performance: [a, b], attendance: [] }, update: (id, patch) => { p.rows = p.rows.map(r => r.id === id ? { ...r, ...patch } : r); p.all.performance = p.rows; }, notify: finish };
  const renderers = new Map();
  const detail = (tree, record) => {
    const element = nodes(tree).find(n => n.type === 'Desk').props.children(record);
    const key = element.key || record.id;
    if (!renderers.has(key)) renderers.set(key, harness('PerformanceViews.tsx', 'PerformanceDetail'));
    return renderers.get(key)(element.props);
  };
  const input = (tree, label) => nodes(nodes(tree).find(n => n.type === 'label' && content(n).startsWith(label))).find(n => n.type === 'Input' || n.type === 'Textarea');
  let tree = render({ p }); detail(tree, a);
  input(detail(tree, b), '核实无故缺勤小时').props.onChange({ target: { value: '6' } });
  const book = new (require('exceljs').Workbook)(), sheet = book.addWorksheet('自评');
  sheet.addRow(['人员编号', '考核目标', '自评分']); sheet.addRow(['E-001', '导入新目标', 79]);
  const bytes = await book.xlsx.writeBuffer();
  nodes(tree).find(n => n.type === 'Input' && n.props['aria-label'] === '导入 Excel 自评文件').props.onChange({ target: { files: [{ size: bytes.length, arrayBuffer: async () => bytes }], value: 'import.xlsx' } });
  await completed;
  tree = render({ p });
  assert.equal(input(detail(tree, p.rows[0]), '本月考核目标').props.value, '导入新目标');
  assert.equal(input(detail(tree, p.rows[0]), '自评分').props.value, '79');
  assert.equal(input(detail(tree, p.rows[1]), '核实无故缺勤小时').props.value, '6');
});
