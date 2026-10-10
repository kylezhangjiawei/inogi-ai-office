import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

const compile = source => ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
function model(name) { const out = {}; new Function('exports', 'require', compile(readFileSync(new URL(`../src/app/hr/${name}.ts`, import.meta.url), 'utf8')))(out, dep => model(dep.replace('./',''))); return out; }
const schema = model('recruitmentSchema'); const logic = model('recruitmentLogic');
function host(name, file = 'RecruitmentViews.tsx') {
  let cursor = 0; const values = []; const out = {};
  const jsx = (type, props) => ({ type, props: props || {} });
  const dependencies = { react: { useRef(initial) { const i = cursor++; if (!(i in values)) values[i] = { current: initial }; return values[i]; }, useState(initial) { const i = cursor++; if (!(i in values)) values[i] = typeof initial === 'function' ? initial() : initial; return [values[i], next => { values[i] = typeof next === 'function' ? next(values[i]) : next; }]; } }, 'react/jsx-runtime': { jsx, jsxs: jsx }, 'react-router': { Link: 'a' }, 'lucide-react': {}, './recruitmentSchema': schema, './recruitmentLogic': logic, './WorkViews': { Attachment: 'Attachment', Badge: 'Badge', Desk: 'Desk', Facts: 'Facts', Notice: 'Notice', Select: 'Select', ViewSwitch: 'ViewSwitch', download() {} } };
  dependencies['./hrLogic'] = model('hrLogic');
  dependencies['../../mocks/hrPreview'] = {};
  dependencies['../components/ui/dialog'] = {};
  dependencies['../components/horizon/HorizonPage'] = {};
  const source = readFileSync(new URL(`../src/app/hr/${file}`, import.meta.url), 'utf8');
  new Function('exports', 'require', `${compile(source)}\nexports.subject = ${name};`)(out, dep => {
    if (/components\/ui\//.test(dep)) return { Input: 'Input', Textarea: 'Textarea', Button: 'Button', NativeSelect: 'NativeSelect' };
    assert.ok(dep in dependencies, dep); return dependencies[dep];
  });
  return { render(props) { cursor = 0; return out.subject(props); } };
}
const nodes = tree => !tree || typeof tree !== 'object' ? [] : Array.isArray(tree) ? tree.flatMap(nodes) : [tree, ...nodes(tree.props?.children)];
const text = tree => tree == null || typeof tree === 'boolean' ? '' : typeof tree !== 'object' ? String(tree) : Array.isArray(tree) ? tree.map(text).join('') : text(tree.props.children);
const button = (tree, label) => nodes(tree).find(node => node.type === 'Button' && text(node) === label);
const baseRow = { id: 'R-001', title: '候选人 A', dept: '研发注册部', owner: '陈安', status: '待填写', date: '2026-11-02', fields: {}, history: [], detail: '' };
function props(id, row = baseRow, role = '人力负责人') {
  const updates = []; const all = { [id]: [row], archive: [], resume: [], apply: [], interview: [], assess: [], offer: [] };
  return { p: { module: { id, fields: [], statuses: ['草稿','已批准'] }, role, rows: [row], all, update: (...value) => updates.push(value), updateModule: (...value) => updates.push(value), add: () => 'NEW-001', notify() {} }, row, updates };
}

test('候选人草稿允许字段缺失，但错误联系方式不能写入会话', () => {
  const subject = host('CandidateEntry'); const values = props('collect'); const passed = { ...values, mode: 'collect', onSaved() {} };
  let tree = subject.render(passed);
  nodes(tree).find(node => node.props['aria-label'] === '联系电话').props.onChange({ target: { value: '错误电话' } });
  tree = subject.render(passed); button(tree, '保存填写草稿').props.onClick();
  assert.equal(values.updates.length, 0);
  assert.match(text(subject.render(passed)), /联系电话格式/);
  nodes(subject.render(passed)).find(node => node.props['aria-label'] === '联系电话').props.onChange({ target: { value: '13800000000' } });
  button(subject.render(passed), '保存填写草稿').props.onClick();
  assert.equal(values.updates.length, 1);
  assert.equal(values.updates[0][1].status, '待填写');
});

test('员工自助采集视角不能核对归档或替HR创建档案', () => {
  const filled = { ...baseRow, status: '待核对', fields: { '联系电话': '13800000000','个人邮箱': 'a@example.com','学历': '本科','毕业学校': '大学','所学专业': '机械','身份证号码': '110101199001010011','现居住地址': '演示地址','紧急联系人': '甲','紧急联系人电话': '13900000000','预计报到日期': '2026-11-02','教育培训经历': '大学','工作经历': '无','信息真实性声明': '已确认','填表人签名': '候选人 A' } };
  const values = props('collect', filled, '员工本人'); const subject = host('Intake'); const tree = subject.render(values);
  const archive = button(tree, '核对并生成演示档案');
  assert.ok(!archive || archive.props.disabled, '本人不得执行HR归档');
});

test('管理者OFFER列表导出与详情不包含薪资邮件或材料，HR保留原资料', () => {
  const row = { ...baseRow, fields: { '标准月薪': '99999', '拟录用岗位': '研发工程师', '邮件正文': '机密薪资内容', '简历附件': 'secret.pdf' }, history: ['本次演示 · 标准月薪：9000 → 99999','本次演示 · 审批通过'] };
  const values = props('offer', row, '部门负责人');
  const tree = host('RecruitmentViews').render(values);
  assert.equal(tree.props.allowEdit, false);
  assert.equal(tree.props.p.rows[0].fields['标准月薪'], undefined);
  assert.equal(tree.props.p.rows[0].fields['邮件正文'], undefined);
  assert.equal(tree.props.p.rows[0].fields['简历附件'], undefined);
  assert.doesNotMatch(JSON.stringify(tree.props.p.rows), /99999|secret\.pdf/);
  const hr = host('RecruitmentViews').render(props('offer', row));
  assert.equal(hr.props.p.rows[0].fields['标准月薪'], '99999');
});

test('业务面试官默认只能编辑自身视角，切至人事视角只读且保存被禁用', () => {
  const subject = host('Interview'); const values = props('interview', baseRow, '部门负责人');
  let tree = subject.render(values);
  assert.equal(button(tree, '提交业务面试官评价').props.disabled, false);
  nodes(tree).find(node => node.type === 'Select' && node.props.label === '评价视角').props.onChange('人事面试官');
  tree = subject.render(values);
  assert.equal(button(tree, '提交人事面试官评价').props.disabled, true);
  const reviewFields = nodes(tree).filter(node => node.type === 'fieldset' && ['hr-interview-dimension', 'hr-stack'].includes(node.props.className));
  assert.equal(reviewFields.length, 6);
  assert.ok(reviewFields.every(node => node.props.disabled));
  assert.equal(nodes(tree).find(node => node.type === 'fieldset' && node.props.className === 'hr-business-fieldset').props.disabled, false, '业务面试官仍可维护自己的录音，不能修改人事评价');
});

test('共享编辑入口同样阻止入学晚于毕业，避免绕过候选人表单校验', () => {
  const subject = host('RecordForm', 'WorkViews.tsx');
  const values = props('apply', { ...baseRow, fields: { '入学日期': '2026-09-01', '毕业日期': '2024-06-01' } });
  let closed = false;
  const passed = { ...values, onClose() { closed = true; } };
  nodes(subject.render(passed)).find(node => node.type === 'form').props.onSubmit({ preventDefault() {} });
  assert.equal(values.updates.length, 0);
  assert.equal(closed, false);
  assert.match(text(subject.render(passed)), /毕业日期不能早于入学日期/);
});
