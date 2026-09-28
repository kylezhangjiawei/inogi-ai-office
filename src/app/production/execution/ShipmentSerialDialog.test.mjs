import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

function compile(file, result, bindings = {}) {
  const source = readFileSync(new URL(file, import.meta.url), 'utf8'), ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const body = ast.statements.filter(node => !ts.isImportDeclaration(node)).map(node => node.getText(ast)).join('\n');
  const code = ts.transpileModule(body, { compilerOptions: { jsx: ts.JsxEmit.React, target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  return new Function(...Object.keys(bindings), `const exports = {};\n${code}\nreturn ${result};`)(...Object.values(bindings));
}
const React = { createElement: (type, props, ...children) => ({ type, props: { ...props, children: children.length === 1 ? children[0] : children } }) };
const elements = tree => Array.isArray(tree) ? tree.flatMap(elements) : tree && typeof tree === 'object' ? [tree, ...Object.values(tree.props ?? {}).flatMap(elements)] : [];
const find = (tree, predicate) => elements(tree).find(predicate);
const availableShipmentSerials = compile('./ShipmentSerialDialog.tsx', 'availableShipmentSerials');
const ranges = [{ id: 'old', batchId: 'b1', serialNumbers: ['OLD'] }, { id: 'current', supersedesId: 'old', batchId: 'b1', serialNumbers: ['SN-A', 'SN-B'], softwareVersion: 'S1', hardwareVersion: '' }, { id: 'other', batchId: 'b2', serialNumbers: ['OTHER'] }];
test('只能选择本批次有效已有SN，排除其他有效发货单；冲销后可重新关联原号码', () => {
  const shipped = { serials: [{ number: 'sn-a' }] };
  assert.deepEqual(availableShipmentSerials('b1', ranges, [shipped]).map(row => row.number), ['SN-B']);
  assert.deepEqual(availableShipmentSerials('b1', ranges, [{ ...shipped, reversed: {} }]).map(row => row.number), ['SN-A', 'SN-B']);
});

test('发20关联12待补8；旧发货不会因为批次已有SN而显示完成，冲销保留原记录', () => {
  const View = compile('./LifecycleShipmentSerials.tsx', 'LifecycleShipmentSerials', { React, ProductionMetrics: 'ProductionMetrics', LifecycleTable: 'LifecycleTable', lifecycleDate: value => value });
  const serials = Array.from({ length: 12 }, (_, i) => ({ number: `SN-${i}`, softwareVersion: 'S1', hardwareVersion: '' }));
  const tree = View({ shipment: { quantity: 20, serials } });
  assert.deepEqual(find(tree, row => row.type === 'ProductionMetrics').props.items.map(row => row.value), ['20 台', '12 个', '8 台']);
  assert.deepEqual(find(View({ shipment: { quantity: 20 } }), row => row.type === 'ProductionMetrics').props.items.map(row => row.value), ['20 台', '0 个', '20 台']);
  const reversed = View({ shipment: { quantity: 20, serials, reversed: {} } });
  assert.match(find(reversed, row => row.type === 'LifecycleTable').props.title, /已随原单冲销/);
  assert.equal(find(reversed, row => row.type === 'LifecycleTable').props.rows.length, 12);
});

test('选择实发SN后明确核对依据，失败保留选择并复用提交ID，成功只提交选择的子集', async () => {
  let slot = 0, first = true, closed = 0, saved = 0;
  const slots = [], writes = [], refs = [];
  let refSlot = 0;
  const bindings = { React, useId: () => 'sn', useEffect: () => {}, useState(initial) { const i = slot++; if (!(i in slots)) slots[i] = initial; return [slots[i], value => { slots[i] = typeof value === 'function' ? value(slots[i]) : value; }]; }, useRef(initial) { const i = refSlot++; return refs[i] ??= { current: initial }; }, crypto: { randomUUID: () => 'serial-submit-id' } };
  for (const name of ['Button', 'Checkbox', 'Input', 'Label', 'Textarea', 'Dialog', 'DialogContent', 'DialogDescription', 'DialogFooter', 'DialogHeader', 'DialogTitle']) bindings[name] = name;
  const View = compile('./ShipmentSerialDialog.tsx', 'ShipmentSerialDialog', bindings);
  const props = { shipment: { id: 's1', voucher: 'FH1', batchId: 'b1', quantity: 1 }, ranges, shipments: [], onClose: () => closed++, onSaved: () => saved++, submit: async (...args) => { writes.push(args); if (first) { first = false; throw new Error('网络失败'); } } };
  const render = () => { slot = 0; refSlot = 0; return View(props); };
  const checks = () => elements(render()).filter(row => row.type === 'Checkbox');
  checks()[0].props.onCheckedChange(true);
  assert.equal(checks()[1].props.disabled, true, '不可选超过实发待补数');
  find(render(), row => row.type === 'Textarea').props.onChange({ target: { value: '原发货清单核对' } });
  await find(render(), row => row.type === 'form').props.onSubmit({ preventDefault() {} });
  assert.equal(find(render(), row => row.props.role === 'alert').props.children, '网络失败');
  assert.equal(checks()[0].props.checked, true);
  await find(render(), row => row.type === 'form').props.onSubmit({ preventDefault() {} });
  assert.deepEqual(writes, [[['SN-A'], '原发货清单核对', 'serial-submit-id'], [['SN-A'], '原发货清单核对', 'serial-submit-id']]);
  assert.equal(saved, 1); assert.equal(closed, 0);
});
