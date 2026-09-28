import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

const source = readFileSync(new URL('../src/app/procurement/WarehouseFlowPage.tsx', import.meta.url), 'utf8');
const ast = ts.createSourceFile('WarehouseFlowPage.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const node = ast.statements.find((row) => ts.isFunctionDeclaration(row) && row.name?.text === 'WarehouseReconcileEditor');
assert.ok(node);
const code = ts.transpileModule(`${node.getText(ast).replace(/^export\s+/, '')}\nreturn WarehouseReconcileEditor;`, { compilerOptions: { jsx: ts.JsxEmit.React, target: ts.ScriptTarget.ES2022 } }).outputText;
const elements = (tree) => Array.isArray(tree) ? tree.flatMap(elements) : tree && typeof tree === 'object' ? [tree, ...Object.values(tree.props ?? {}).flatMap(elements)] : [];
const find = (tree, type, id) => elements(tree).find((row) => row.type === type && (!id || row.props.id === id));
const flush = () => new Promise((resolve) => setImmediate(resolve));
function fixture({ revoke = false, send } = {}) {
  let slot = 0, initialized = false;
  const slots = [], effects = [], cleanups = [], writes = [], saved = [];
  const event = { id: 'event-1', action: 'issue', at: '2026-09-16T01:00:00Z', lines: [{ code: 'V01', warehouse: '量产仓', quantity: 40 }] };
  const issue = { id: 'task-1', version: 5, title: '阀装配', lines: [{ code: 'V01', name: '阀体', unit: '件' }], history: [event] };
  const bindings = {
    React: { createElement: (type, props, ...children) => ({ type, props: { ...props, children: children.length === 1 ? children[0] : children } }) },
    useState(initial) { const i = slot++; if (!(i in slots)) slots[i] = typeof initial === 'function' ? initial() : initial; return [slots[i], (value) => { slots[i] = typeof value === 'function' ? value(slots[i]) : value; }]; },
    useRef(initial) { const i = slot++; return slots[i] ??= { current: initial }; },
    useEffect(callback) { if (!initialized) effects.push(callback); }, useId: () => 'check-test', useI18n: () => ({ t: (text) => text }),
    latestCheck: () => undefined, qty: String,
    reconcileWarehouseFlow: async (id, input) => { writes.push({ id, ...input }); return send ? send(id, input) : { id }; },
    requestAnimationFrame: (run) => run(), document: { getElementById: () => ({ focus() {} }) },
  };
  for (const name of ['Button', 'Input', 'Label', 'Textarea', 'Checkbox', 'Loader2', 'Dialog', 'DialogContent', 'DialogDescription', 'DialogFooter', 'DialogHeader', 'DialogTitle', 'AlertDialog', 'AlertDialogAction', 'AlertDialogCancel', 'AlertDialogContent', 'AlertDialogDescription', 'AlertDialogFooter', 'AlertDialogHeader', 'AlertDialogTitle']) bindings[name] = name;
  const Component = new Function(...Object.keys(bindings), code)(...Object.values(bindings));
  const render = () => { slot = 0; const tree = Component({ issue, event, revoke, onClose: () => saved.push('closed'), onSaved: () => saved.push('saved') }); if (!initialized) { initialized = true; effects.forEach((effect) => { const cleanup = effect(); if (cleanup) cleanups.push(cleanup); }); } return tree; };
  const f = { render, writes, saved, destroy: () => cleanups.forEach((run) => run()) }; render(); return f;
}
const change = (f, suffix, value, type = 'Input') => find(f.render(), type, `check-test-${suffix}`).props.onChange({ target: { value } });
const check = (f, suffix) => find(f.render(), 'Checkbox', `check-test-${suffix}`).props.onCheckedChange(true);
const submit = async (f) => { find(f.render(), 'form').props.onSubmit({ preventDefault() {} }); await flush(); };
function fill(f, quantity = '40') {
  for (const [suffix, value] of [['voucher', 'CLCK-001'], ['line-0', '1'], ['total-0', '60'], ['quantity-0', quantity]]) change(f, suffix, value);
  change(f, 'reason', '已查阅T+生效凭证附件', 'Textarea');
}
test('差异保存不伪装为一致，核对结果由服务端决定，不提交身份或完成状态', async () => {
  const f = fixture(); fill(f, '30');
  assert.equal(elements(f.render()).find((row) => row.type === 'Button' && row.props.type === 'submit').props.children[1], '保存差异');
  await submit(f);
  assert.equal(f.writes.length, 1); assert.equal(f.writes[0].posted, false); assert.equal(f.writes[0].detailsMatch, false);
  assert.deepEqual(f.writes[0].lines, [{ code: 'V01', voucherLine: '1', quantity: 30, voucherQuantity: 60 }]);
  assert.equal(f.writes[0].eventId, 'event-1'); assert.equal(f.writes[0].version, 5);
  assert.equal(f.writes[0].actorId, undefined); assert.equal(f.writes[0].result, undefined);
});
test('保存失败保留草稿，重试复用请求编号，内容变更后使用新编号', async () => {
  const f = fixture({ send: async () => { throw new Error('网络暂不可用'); } }); fill(f); check(f, 'posted'); check(f, 'details');
  await submit(f); assert.equal(find(f.render(), 'Input', 'check-test-voucher').props.value, 'CLCK-001');
  assert.ok(elements(f.render()).some((row) => row.props.role === 'alert')); assert.deepEqual(f.saved, []);
  await submit(f); assert.equal(f.writes[0].requestId, f.writes[1].requestId);
  change(f, 'reason', '补充附件索引', 'Textarea'); await submit(f); assert.notEqual(f.writes[1].requestId, f.writes[2].requestId);
});
test('空数量不能作为0保存；关闭脏草稿须先确认', async () => {
  const f = fixture(); fill(f, ''); await submit(f); assert.equal(f.writes.length, 0);
  find(f.render(), 'Dialog').props.onOpenChange(false);
  assert.equal(find(f.render(), 'AlertDialog').props.open, true); assert.deepEqual(f.saved, []);
});
test('双击提交只发一次，保存中不能关闭，迟到响应不影响已离开的页面', async () => {
  let resolve; const waiting = new Promise((res) => { resolve = res; });
  const f = fixture({ send: () => waiting }); fill(f); check(f, 'posted'); check(f, 'details');
  await submit(f); await submit(f); assert.equal(f.writes.length, 1); assert.equal(find(f.render(), 'fieldset').props.disabled, true);
  find(f.render(), 'Dialog').props.onOpenChange(false); assert.deepEqual(f.saved, []);
  f.destroy(); resolve({ id: 'task-1' }); await flush(); assert.deepEqual(f.saved, []);
});
test('撤回先展示确认，确认后仅发送原发料编号、版本与原因', async () => {
  const f = fixture({ revoke: true }); change(f, 'reason', 'T+凭证冲销，需重新核对', 'Textarea'); await submit(f);
  assert.equal(f.writes.length, 0);
  const dialog = elements(f.render()).filter((row) => row.type === 'AlertDialog')[1]; assert.equal(dialog.props.open, true);
  find(dialog, 'AlertDialogAction').props.onClick(); await flush();
  assert.equal(f.writes.length, 1); assert.equal(f.writes[0].revoke, true); assert.equal(f.writes[0].voucherNumber, undefined); assert.equal(f.writes[0].lines, undefined); assert.deepEqual(f.saved, ['saved']);
});
