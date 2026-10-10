import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

const read = name => readFileSync(new URL(`../src/${name}`, import.meta.url), 'utf8');
const compile = source => ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
const models = new Map();
function model(name) {
  if (models.has(name)) return models.get(name);
  const out = {};
  new Function('exports', 'require', compile(read(name)))(out, dep => model(`app/hr/${dep.replace('./', '')}.ts`));
  models.set(name, out); return out;
}
const schema = model('app/hr/recruitmentSchema.ts');
const logic = model('app/hr/recruitmentLogic.ts');
const hrLogic = model('app/hr/hrLogic.ts');
const data = model('mocks/hrPreview.ts');
function host(name, file = 'RecruitmentViews.tsx') {
  let cursor = 0; const values = []; const out = {};
  const jsx = (type, props) => ({ type, props: props || {} });
  const dependencies = {
    react: {
      useRef(initial) { const i = cursor++; if (!(i in values)) values[i] = { current: initial }; return values[i]; },
      useState(initial) { const i = cursor++; if (!(i in values)) values[i] = typeof initial === 'function' ? initial() : initial; return [values[i], next => { values[i] = typeof next === 'function' ? next(values[i]) : next; }]; },
    },
    'react/jsx-runtime': { jsx, jsxs: jsx }, 'react-router': { Link: 'a' }, 'lucide-react': {},
    './recruitmentSchema': schema, './recruitmentLogic': logic, './hrLogic': hrLogic,
    './WorkViews': { Attachment: 'Attachment', Badge: 'Badge', Desk: 'Desk', Facts: 'Facts', Notice: 'Notice', Select: 'Select', ViewSwitch: 'ViewSwitch', download() {} },
    '../../mocks/hrPreview': data, '../components/horizon/HorizonPage': {},
  };
  new Function('exports', 'require', `${compile(read(`app/hr/${file}`))}\nexports.subject = ${name};`)(out, dep => {
    if (/components\/ui\//.test(dep)) return { Input: 'Input', Textarea: 'Textarea', Button: 'Button', NativeSelect: 'NativeSelect' };
    assert.ok(dep in dependencies, dep); return dependencies[dep];
  });
  return { render(props) { cursor = 0; return out.subject(props); } };
}
const nodes = tree => !tree || typeof tree !== 'object' ? [] : Array.isArray(tree) ? tree.flatMap(nodes) : [tree, ...nodes(tree.props?.children)];
const text = tree => tree == null || typeof tree === 'boolean' ? '' : typeof tree !== 'object' ? String(tree) : Array.isArray(tree) ? tree.map(text).join('') : text(tree.props.children);
const button = (tree, label) => nodes(tree).find(node => node.type === 'Button' && text(node) === label);
function fixture(id, role = '人力负责人', index = 0) {
  const state = data.createHrState(); const updates = []; const crossUpdates = []; const row = state[id][index];
  const module = data.hrModules.find(item => item.id === id);
  const p = { module: { ...module, fields: [...new Set([...module.fields, ...(schema.recruitmentExtraFields[id] || [])])] }, role, employeeId: row.fields['人员编号'], department: row.dept, rows: state[id], all: state,
    update(recordId, patch, event) { updates.push({ recordId, patch, event }); state[id] = state[id].map(item => item.id === recordId ? hrLogic.prepareHrUpdate(id, item, patch, event) : item); },
    updateModule(...args) { crossUpdates.push(args); }, add() { throw new Error('Unexpected new record'); }, notify() {},
  };
  return { p, row, state, updates, crossUpdates };
}

for (const role of ['部门负责人', '总经理']) {
  test(`${role}不能通过简历详情保存 HR 人工校准`, () => {
    const view = host('Screening'); const f = fixture('resume', role);
    assert.equal(hrLogic.canManageModule('resume', role), false);
    nodes(view.render(f)).find(node => node.props['aria-label'] === '复核理由').props.onChange({ target: { value: '只读角色试图覆盖校准' } });
    button(view.render(f), '保存复核结论').props.onClick();
    assert.equal(f.updates.length, 0);
  });
  test(`${role}不能通过应聘登记详情替换扫描材料或确认资料`, () => {
    const view = host('Registration'); const f = fixture('apply', role);
    const tree = view.render(f);
    nodes(tree).find(node => node.type === 'Attachment').props.onChange('replacement.pdf');
    button(tree, '确认已核对').props.onClick();
    assert.equal(f.updates.length, 0);
  });
  test(`${role}不能经候选人填写入口修改入职草稿`, () => {
    const view = host('CandidateEntry'); const f = fixture('collect', role);
    const props = { ...f, mode: 'collect', onSaved() {} };
    button(view.render(props), '保存填写草稿').props.onClick();
    assert.equal(f.updates.length, 0);
  });
  test(`${role}不能通过测评详情保存配置`, () => {
    const view = host('Assess'); const f = fixture('assess', role);
    nodes(view.render(f)).find(node => node.props['aria-label'] === '外部测评链接').props.onChange({ target: { value: 'https://assessment.example.com/changed' } });
    button(view.render(f), '保存测评链接').props.onClick();
    assert.equal(f.updates.length, 0);
  });
  test(`${role}不能发起测评、替换回传报告、确认或同步档案`, () => {
    const view = host('Assess'); const f = fixture('assess', role);
    f.row.fields['测评链接'] = 'https://assessment.example.com/start';
    button(view.render(f), '发起测评 · 等待回传').props.onClick();
    assert.equal(f.updates.length, 0);
    f.row.status = '进行中';
    f.row.fields['报告文件'] = 'original.pdf';
    nodes(view.render(f)).find(node => node.type === 'Attachment').props.onChange('unauthorized.pdf');
    nodes(view.render(f)).find(node => node.props['aria-label'] === '报告结论摘要').props.onChange({ target: { value: '报告摘要' } });
    nodes(view.render(f)).find(node => node.props['aria-label'] === '人工岗位适配建议').props.onChange({ target: { value: '结合面试核对' } });
    button(view.render(f), '确认报告回传并完成测评').props.onClick();
    assert.equal(f.updates.length, 0);
    f.row.status = '已完成';
    f.row.fields['人员编号'] = f.p.all.archive[0].fields['人员编号'];
    nodes(view.render(f)).find(node => node.props['aria-label'] === '目标人员档案').props.onChange({ target: { value: f.p.all.archive[0].id } });
    button(view.render(f), '关联人员并同步报告摘要').props.onClick();
    assert.equal(f.updates.length, 0);
    assert.equal(f.crossUpdates.length, 0);
  });
}
test('总经理的面试只读视角不能替人事面试官写入录音', () => {
  const view = host('Interview'); const f = fixture('interview', '总经理');
  const tree = view.render(f);
  assert.equal(button(tree, '提交人事面试官评价').props.disabled, true);
  nodes(tree).find(node => node.type === 'Attachment').props.onChange('gm-recording.mp3');
  assert.equal(f.updates.length, 0);
});
test('已确认应聘登记更換扫描件后必须重新核对', () => {
  const view = host('Registration'); const f = fixture('apply', '人力负责人', 1);
  assert.equal(f.row.status, '已确认');
  nodes(view.render(f)).find(node => node.type === 'Attachment').props.onChange('corrected-source.pdf');
  const saved = f.state.apply.find(row => row.id === f.row.id);
  assert.equal(saved.status, '待核对');
  assert.notEqual(saved.fields['识别待核对'], '无');
});
test('已确认应聘登记通过共享编辑改资料后必须重新核对', () => {
  const view = host('RecordForm', 'WorkViews.tsx'); const f = fixture('apply', '人力负责人', 1);
  const props = { ...f, onClose() {} };
  nodes(view.render(props)).find(node => node.props['aria-label'] === '毕业学校').props.onChange({ target: { value: '修正后的毕业学校' } });
  nodes(view.render(props)).find(node => node.type === 'form').props.onSubmit({ preventDefault() {} });
  assert.equal(f.updates.length, 1);
  assert.equal(f.state.apply.find(row => row.id === f.row.id).status, '待核对');
});
test('员工本人可保存自己的采集草稿，但不能修改其他人员的草稿', () => {
  const view = host('CandidateEntry'); const f = fixture('collect', '员工本人');
  button(view.render({ ...f, mode: 'collect', onSaved() {} }), '保存填写草稿').props.onClick();
  assert.equal(f.updates.length, 1);
  f.p.employeeId = 'E-OTHER';
  button(view.render({ ...f, mode: 'collect', onSaved() {} }), '保存填写草稿').props.onClick();
  assert.equal(f.updates.length, 1);
});
test('HR 仍可保存筛选、登记与采集信息，部门负责人仍可上传本人业务面试录音', () => {
  const screening = host('Screening'); const resume = fixture('resume');
  nodes(screening.render(resume)).find(node => node.props['aria-label'] === '复核理由').props.onChange({ target: { value: '已核对项目经历' } });
  button(screening.render(resume), '保存复核结论').props.onClick();
  assert.equal(resume.updates.length, 1);
  const registration = fixture('apply');
  button(host('Registration').render(registration), '确认已核对').props.onClick();
  assert.equal(registration.state.apply[0].status, '已确认');
  const collect = fixture('collect');
  button(host('CandidateEntry').render({ ...collect, mode: 'collect', onSaved() {} }), '保存填写草稿').props.onClick();
  assert.equal(collect.updates.length, 1);
  const interview = fixture('interview', '部门负责人');
  nodes(host('Interview').render(interview)).find(node => node.type === 'Attachment').props.onChange('business-interview.mp3');
  assert.equal(interview.updates[0].patch.fields['业务面试官录音'], 'business-interview.mp3');
});
test('HR 测评配置、发起、报告确认与关联档案仍可完整推进', () => {
  const view = host('Assess'); const f = fixture('assess');
  const props = () => ({ p: f.p, row: f.state.assess[0] });
  nodes(view.render(props())).find(node => node.props['aria-label'] === '外部测评链接').props.onChange({ target: { value: 'https://assessment.example.com/start' } });
  button(view.render(props()), '保存测评链接').props.onClick();
  button(view.render(props()), '发起测评 · 等待回传').props.onClick();
  assert.equal(f.state.assess[0].status, '进行中');
  nodes(view.render(props())).find(node => node.type === 'Attachment').props.onChange('verified-report.pdf');
  nodes(view.render(props())).find(node => node.props['aria-label'] === '报告结论摘要').props.onChange({ target: { value: '已核实报告结论' } });
  nodes(view.render(props())).find(node => node.props['aria-label'] === '人工岗位适配建议').props.onChange({ target: { value: '结合面试事实使用' } });
  button(view.render(props()), '确认报告回传并完成测评').props.onClick();
  assert.equal(f.state.assess[0].status, '已完成');
  f.p.all.archive.push({ ...f.p.all.archive[0], id: 'NEW-ARCHIVE', fields: { ...f.p.all.archive[0].fields, '人员编号': f.row.fields['人员编号'], '候选人编号': f.row.fields['候选人编号'] } });
  nodes(view.render(props())).find(node => node.props['aria-label'] === '目标人员档案').props.onChange({ target: { value: 'NEW-ARCHIVE' } });
  button(view.render(props()), '关联人员并同步报告摘要').props.onClick();
  assert.equal(f.crossUpdates.length, 1);
  assert.equal(f.crossUpdates[0][0], 'archive');
  assert.equal(f.state.assess[0].fields['关联档案编号'], 'NEW-ARCHIVE');
});

test('重复保存相同测评配置保留完成状态、报告与批次，并给出未变化提示', () => {
  const view = host('Assess'); const f = fixture('assess'); const notifications = [];
  f.row.status = '已完成';
  Object.assign(f.row.fields, { '测评链接': 'https://assessment.example.com/saved', '测评类型': '职业行为测评', '测评结论': '已核对结论', '报告文件': 'complete.pdf', '报告回传状态': '已人工核对', '测评批次': '4' });
  f.p.notify = message => notifications.push(message);
  const before = structuredClone(f.row);
  button(view.render(f), '保存测评链接').props.onClick();
  assert.equal(f.updates.length, 0);
  assert.deepEqual(f.state.assess[0], before);
  assert.match(notifications.at(-1), /未变化|保留/);
  nodes(view.render(f)).find(node => node.props['aria-label'] === '外部测评链接').props.onChange({ target: { value: '  https://assessment.example.com/saved  ' } });
  button(view.render(f), '保存测评链接').props.onClick();
  assert.equal(f.updates.length, 0, 'leading/trailing whitespace is not a new assessment batch');
  assert.deepEqual(f.state.assess[0], before);
});

test('真实修改测评类型仍可建立新批次并要求重新回传报告', () => {
  const view = host('Assess'); const f = fixture('assess');
  f.row.status = '已完成';
  Object.assign(f.row.fields, { '测评链接': 'https://assessment.example.com/saved', '测评类型': '职业行为测评', '测评结论': '旧结论', '报告文件': 'old.pdf', '测评批次': '4' });
  nodes(view.render(f)).find(node => node.type === 'Select' && node.props.label === '测评类型').props.onChange('MBTI');
  button(view.render(f), '保存测评链接').props.onClick();
  const saved = f.state.assess[0];
  assert.equal(saved.status, '待测评');
  assert.equal(saved.fields['测评类型'], 'MBTI');
  assert.equal(saved.fields['测评批次'], '5');
  assert.equal(saved.fields['报告文件'], '');
  assert.equal(saved.fields['测评结论'], '');
});

test('候选人页内草稿只更新登记字段，不覆盖后来换入的扫描材料和关联编号', () => {
  const view = host('CandidateEntry'); const f = fixture('apply');
  f.row.fields['扫描材料'] = 'old.pdf';
  const props = { ...f, mode: 'apply', onSaved() {} };
  nodes(view.render(props)).find(node => node.props['aria-label'] === '毕业学校').props.onChange({ target: { value: '草稿中的新学校' } });
  props.row = { ...f.row, fields: { ...f.row.fields, '扫描材料': 'corrected.pdf', '关联档案编号': 'NEW-ARCHIVE' } };
  button(view.render(props), '保存填写草稿').props.onClick();
  assert.equal(f.updates[0].patch.fields['毕业学校'], '草稿中的新学校');
  assert.equal(f.updates[0].patch.fields['扫描材料'], 'corrected.pdf');
  assert.equal(f.updates[0].patch.fields['关联档案编号'], 'NEW-ARCHIVE');
});
