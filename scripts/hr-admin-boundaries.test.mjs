import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

const compile = source => ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
const logic = {};
new Function('exports', compile(readFileSync(new URL('../src/app/hr/businessLogic.ts', import.meta.url), 'utf8')))(logic);
const jsx = (type, props) => ({ type, props: props || {} });
const nodes = tree => !tree || typeof tree !== 'object' ? [] : Array.isArray(tree) ? tree.flatMap(nodes) : [tree, ...nodes(tree.props?.children)];
const text = tree => tree == null || typeof tree === 'boolean' ? '' : typeof tree !== 'object' ? String(tree) : Array.isArray(tree) ? tree.map(text).join('') : text(tree.props.children);
const button = (tree, label) => nodes(tree).find(node => node.type === 'Button' && text(node) === label);
const field = (tree, label) => nodes(tree).find(node => node.props['aria-label'] === label);
const row = (id, fields, extra = {}) => ({ id, title: id, fields, dept: '人事行政部', owner: '演示人员', status: '待复核', date: '2026-10-16', history: [], ...extra });
function host(name) {
  let cursor = 0; const values = [], out = {};
  const components = new Proxy({}, { get: (_, key) => key });
  const deps = {
    react: { useState(initial) { const i = cursor++; if (!(i in values)) values[i] = typeof initial === 'function' ? initial() : initial; return [values[i], next => { values[i] = typeof next === 'function' ? next(values[i]) : next; }]; } },
    'react/jsx-runtime': { jsx, jsxs: jsx }, 'react-router': { Link: 'a' }, 'lucide-react': {},
    './businessLogic': logic, './OrganizationBusinessViews': components,
    './WorkViews': { ...Object.fromEntries(['Attachment', 'Badge', 'Desk', 'Facts', 'Notice'].map(key => [key, key])), copySessionAttachment: () => false },
  };
  const source = readFileSync(new URL('../src/app/hr/AdministrativeBusinessViews.tsx', import.meta.url), 'utf8') + '\nexport { ExpenseDetail, RoomDetail };';
  new Function('exports', 'require', compile(source))(out, dep => { if (dep.includes('/components/')) return components; assert.ok(dep in deps, dep); return deps[dep]; });
  return props => { cursor = 0; return out[name](props); };
}

test('重新关联只提交凭证字段，保留未保存发票草稿并继续执行正常金额校验', () => {
  const render = host('ExpenseDetail');
  let current = row('EX-1', { 发票号码: 'INV-1', 发票金额: '860', 报销金额: '860', 凭证编号: 'PAY-1', 凭证金额: '860', 人工复核意见: '已核对' });
  const source = row('EX-2', { 凭证编号: 'PAY-2', 凭证金额: '380', 付款方: '公司', 收款方: '供应商' });
  const writes = [], p = { module: { fields: [] }, rows: [current, source], update(id, patch) { writes.push(patch); current = { ...current, ...patch, fields: { ...current.fields, ...patch.fields } }; } };
  const tree = () => render({ p, row: current });
  field(tree(), '发票金额').props.onChange({ target: { value: '-1' } });
  field(tree(), '重新关联付款凭证').props.onChange({ target: { value: source.id } });
  button(tree(), '替换关联并重新复核').props.onClick();
  assert.equal(current.fields['发票金额'], '860');
  assert.equal(current.fields['凭证编号'], 'PAY-2');
  assert.equal(field(tree(), '发票金额').props.value, '-1');
  button(tree(), '保存人工修正').props.onClick();
  assert.equal(writes.length, 1);
  assert.match(text(tree()), /不能留空或小于零/);
  field(tree(), '发票金额').props.onChange({ target: { value: '380' } });
  button(tree(), '保存人工修正').props.onClick();
  assert.equal(current.fields['发票金额'], '380');
});

function roomAction(now, label, start = '2026-10-16T14:30') {
  const render = host('RoomDetail'), writes = [];
  const record = row('RM-1', { 会议室: '大会议室', 开始时间: '14:00', 结束时间: '15:00', 使用开始: start }, { status: '已预约' });
  const props = { row: record, now, p: { module: { fields: [] }, update(id, patch) { writes.push(patch); } } };
  button(render(props), label).props.onClick();
  return { writes, content: text(render(props)) };
}
test('结束和取消均拒绝早于使用开始的时间，保持预约与使用记录不变', () => {
  for (const action of ['结束使用', '取消本次预约']) {
    const result = roomAction('2026-10-16T13:00', action);
    assert.equal(result.writes.length, 0, action);
    assert.match(result.content, /不能早于.*开始/);
  }
});
test('结束和取消均拒绝无效日期、时间和异常使用开始值', () => {
  for (const action of ['结束使用', '取消本次预约']) {
    for (const now of ['2026-02-30T15:00', '2026-10-16T25:00', 'invalid', '']) assert.equal(roomAction(now, action).writes.length, 0, `${action} ${now}`);
    assert.equal(roomAction('2026-10-16T14:40', action, '2026-02-30T14:00').writes.length, 0, action);
  }
});
test('修正时间后可结束或取消，未使用预约仍可提前取消', () => {
  for (const action of ['结束使用', '取消本次预约']) {
    for (const now of ['2026-10-16T14:30', '2026-10-16T14:40']) {
      const result = roomAction(now, action);
      assert.equal(result.writes.length, 1);
      assert.equal(result.writes[0].fields['使用结束'], now);
      if (action === '取消本次预约') assert.equal(result.writes[0].status, '已取消');
    }
  }
  assert.equal(roomAction('2026-10-16T13:00', '取消本次预约', '').writes[0].status, '已取消');
});
