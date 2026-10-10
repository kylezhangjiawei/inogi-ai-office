import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

const source = readFileSync(new URL('../src/app/hr/OrganizationBusinessViews.tsx', import.meta.url), 'utf8');
const ast = ts.createSourceFile('OrganizationBusinessViews.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const component = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'EmployeeRelations');
assert.ok(component, 'test exercises the actual organization relationship component');
const compiled = ts.transpileModule(component.getText(ast), { compilerOptions: { target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React } }).outputText;

function harness(employee) {
  const state = [];
  let cursor = 0;
  const React = { createElement: (type, props, ...children) => ({ type, props: props || {}, children }) };
  const useState = initial => { const index = cursor++; if (!(index in state)) state[index] = typeof initial === 'function' ? initial() : initial; return [state[index], next => { state[index] = typeof next === 'function' ? next(state[index]) : next; }]; };
  const EmployeeRelations = new Function('React', 'useState', 'canManageModule', 'fieldChanges', 'Notice', 'Input', 'Button', 'NativeSelect', compiled + '\nreturn EmployeeRelations;')(React, useState, () => true, () => '关系已更新', 'Notice', 'Input', 'Button', 'NativeSelect');
  const changes = [];
  const events = [];
  const p = { module: { id: 'org' }, role: '人力负责人', all: { archive: [employee] }, updateModule: (...args) => changes.push(args), update: (...args) => events.push(args), notify: () => {} };
  const department = { id: 'D-002', title: '质量部', fields: { 公司主体: '壹诺吉' } };
  const render = () => { cursor = 0; return EmployeeRelations({ p, department }); };
  return { render, changes, events };
}
function nodes(tree) { return Array.isArray(tree) ? tree.flatMap(nodes) : tree && typeof tree === 'object' ? [tree, ...tree.children.flatMap(nodes)] : []; }
function content(tree) { return Array.isArray(tree) ? tree.map(content).join('') : tree && typeof tree === 'object' ? content(tree.children) : String(tree ?? ''); }
const archivedEmployee = { id: 'ARCHIVE-generated-123', title: '新归档员工', dept: '质量部', owner: '陈安', status: '待补齐', date: '2026-10-16', detail: '', history: [], fields: { 人员编号: 'E-003', 公司主体: '壹诺吉', 岗位: '质量工程师', 岗位序列: '质量管理', 直属上级: '许禾', 兼岗信息: '无', 联系电话: '13800138000', 来源采集编号: 'CL-003', 培训成绩: '100' } };

test('新归档员工调整组织关系保留业务人员编号和跨页关联字段', () => {
  const { render, changes, events } = harness(archivedEmployee);
  let tree = render();
  nodes(tree).find(node => node.props['aria-label'] === '选择员工维护关系').props.onChange({ target: { value: archivedEmployee.id } });
  tree = render();
  nodes(tree).find(node => node.props['aria-label'] === '员工兼岗信息').props.onChange({ target: { value: '兼任验证负责人' } });
  tree = render();
  nodes(tree).find(node => node.type === 'Button' && content(node) === '保存组织关系').props.onClick();
  assert.equal(changes.length, 1);
  const [module, recordId, patch] = changes[0];
  assert.equal(module, 'archive');
  assert.equal(recordId, 'ARCHIVE-generated-123', '更新定位仍用档案记录ID');
  assert.equal(patch.fields['人员编号'], 'E-003', '跨招聘、培训、自助范围使用稳定业务人员编号');
  assert.equal(patch.fields['兼岗信息'], '兼任验证负责人');
  assert.equal(patch.fields['联系电话'], '13800138000');
  assert.equal(patch.fields['来源采集编号'], 'CL-003');
  assert.equal(patch.fields['培训成绩'], '100');
  assert.match(events[0][2], /E-003/);
});

test('组织员工表与选择器展示业务编号；旧档案无业务编号时回退记录ID', () => {
  const current = content(harness(archivedEmployee).render());
  assert.equal(current.includes('E-003'), true);
  assert.equal(current.includes('ARCHIVE-generated-123'), false);
  const legacy = { ...archivedEmployee, id: 'E-LEGACY', fields: { ...archivedEmployee.fields, 人员编号: '' } };
  assert.equal(content(harness(legacy).render()).includes('E-LEGACY'), true);
});
