import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
const source = readFileSync(new URL('../src/app/production/execution/ProductionExecutionPage.tsx', import.meta.url), 'utf8');
const ast = ts.createSourceFile('ProductionExecutionPage.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const node = ast.statements.find((row) => ts.isFunctionDeclaration(row) && row.name?.text === 'ExecutionEditor');
assert.ok(node);
const code = ts.transpileModule(`${node.getText(ast)}\nreturn ExecutionEditor;`, { compilerOptions: { jsx: ts.JsxEmit.React, target: ts.ScriptTarget.ES2022 } }).outputText;
const elements = (tree) => Array.isArray(tree) ? tree.flatMap(elements) : tree && typeof tree === 'object' ? [tree, ...Object.values(tree.props ?? {}).flatMap(elements)] : [];
const find = (tree, predicate) => elements(tree).find(predicate);
const flush = () => new Promise((resolve) => setImmediate(resolve));
function deferred() { let resolve; const promise = new Promise((res) => { resolve = res; }); return { promise, resolve }; }
function fixture(editor, overrides = {}) {
  let slot = 0, initialized = false;
  const slots = [], effects = [], cleanups = [], writes = [], saved = [];
  const options = { nodes: [{ id: 'root', productId: 'p1', parentId: null, name: '制氧机' }, { id: 'sub', productId: 'p1', parentId: 'root', name: '阀系统' }], models: ['Q7'], users: [{ id: 'u1', name: '现场人', canReport: true, canCollaborate: true }] };
  const plan = { id: 'plan-1', productId: 'p1', productLine: 'Q7', version: 3, targetQty: 200, shipmentTargetQty: 180, bom: [{ id: 'bom1', code: 'V01', name: '阀体', unit: '件', qtyPer: 2 }], batches: [{ id: 'b1', code: '第一批', quantity: 100 }, { id: 'b2', code: '第二批', quantity: 100 }] };
  const bindings = {
    React: { createElement: (type, props, ...children) => { const resolved = { ...props, children: children.length === 1 ? children[0] : children }; return typeof type === 'function' ? type(resolved) : { type, props: resolved }; } },
    useState(initial) { const i = slot++; if (!(i in slots)) slots[i] = typeof initial === 'function' ? initial() : initial; return [slots[i], (value) => { slots[i] = typeof value === 'function' ? value(slots[i]) : value; }]; },
    useRef(initial) { const i = slot++; return slots[i] ??= { current: initial }; },
    useEffect(callback) { if (!initialized) effects.push(callback); }, useId: () => 'editor-test', useI18n: () => ({ t: (text) => text }),
    Field: ({ label, children }) => ({ type: 'Field', props: { label, children: children(label) } }),
    today: () => '2026-09-16', ACTIONS: { create: '确认月度计划', report: '登记报工', task: '编制作业', dispatch: '确认派工', disposition: '登记质量处置', 'reply-quality': '回复原异常' },
    getExecutionOptions: async () => options,
    createExecutionPlan: async (input) => { writes.push(input); return { id: 'plan-new' }; },
    commandExecutionPlan: async (id, input) => { writes.push({ id, ...input }); return { id }; },
    requestAnimationFrame: (run) => run(), document: { getElementById: () => ({ focus() {} }) },
    ...overrides,
  };
  for (const name of ['Button', 'Input', 'Label', 'Textarea', 'NativeSelect', 'Checkbox', 'Loader2', 'Dialog', 'DialogContent', 'DialogDescription', 'DialogFooter', 'DialogHeader', 'DialogTitle', 'AlertDialog', 'AlertDialogAction', 'AlertDialogCancel', 'AlertDialogContent', 'AlertDialogDescription', 'AlertDialogFooter', 'AlertDialogHeader', 'AlertDialogTitle']) bindings[name] = name;
  const Component = new Function(...Object.keys(bindings), code)(...Object.values(bindings));
  const render = () => { slot = 0; const result = Component({ editor, plan, month: '2026-09', onClose: () => saved.push('closed'), onSaved: (id) => saved.push(id) }); if (!initialized) { initialized = true; effects.forEach((effect) => { const cleanup = effect(); if (cleanup) cleanups.push(cleanup); }); } return result; };
  const f = { render, writes, saved, destroy: () => cleanups.forEach((run) => run()) }; render(); return f;
}
const change = (f, label, value) => { const field = find(f.render(), (row) => row.type === 'Field' && row.props.label === label); assert.ok(field, label); find(field, (row) => ['Input', 'NativeSelect', 'Textarea'].includes(row.type)).props.onChange({ target: { value } }); };
const submit = (f) => find(f.render(), (row) => row.type === 'form').props.onSubmit({ preventDefault() {} });
test('月度计划失败保留输入，网络重试复用请求编号，目标和月份准确提交', async () => {
  const writes = []; let count = 0;
  const f = fixture({ action: 'create' }, { createExecutionPlan: async (input) => { writes.push(input); if (++count === 1) throw new Error('网络暂时不可用'); return { id: 'new-plan' }; } }); await flush();
  for (const [label, value] of [['所属产品', 'p1'], ['生产 BOM 型号', 'Q7'], ['月度生产目标（台）', '300'], ['月度发货目标（台）', '180'], ['操作依据与原因', '已确认目标']]) change(f, label, value);
  await submit(f); assert.ok(find(f.render(), (row) => row.props?.role === 'alert')); assert.equal(f.saved.length, 0);
  await submit(f); assert.equal(writes.length, 2); assert.equal(writes[0].requestId, writes[1].requestId); assert.equal(writes[0].targetQty, 300); assert.equal(writes[0].shipmentTargetQty, 180); assert.equal(writes[0].month, '2026-09'); assert.deepEqual(f.saved, ['new-plan']);
});
test('指定批次编制作业保持原批次，领料提交编码与每件用量而非伪造库存', async () => {
  const f = fixture({ action: 'task', batchId: 'b2' }); await flush();
  const batchField = find(f.render(), (row) => row.type === 'Field' && row.props.label === '所属批次');
  assert.equal(find(batchField, (row) => row.type === 'NativeSelect').props.value, 'b2');
  for (const [label, value] of [['作业名称', '阀装配'], ['所属子系统', 'sub'], ['派工数量', '20'], ['产线或工位', '一线'], ['现场负责人', 'u1'], ['操作依据与原因', '计划确认']]) change(f, label, value);
  find(f.render(), (row) => row.type === 'Checkbox').props.onCheckedChange(true);
  await submit(f); assert.equal(f.writes[0].data.batchId, 'b2'); assert.deepEqual(f.writes[0].data.materials, [{ code: 'V01', qtyPer: 2 }]); assert.equal(f.writes[0].version, 3); assert.equal(f.writes[0].data.quantity, 20);
});
test('派工双击只发送一次，等待时不能关闭；销毁后迟到响应不关闭新页面', async () => {
  const waiting = deferred(), writes = [];
  const f = fixture({ action: 'dispatch', task: { id: 'task-1', name: '装配', line: '一线', ownerName: '甲' } }, { commandExecutionPlan: async (...args) => { writes.push(args); return waiting.promise; } });
  change(f, '操作依据与原因', '确认派工'); const first = submit(f); const second = submit(f);
  assert.equal(writes.length, 1); assert.equal(find(f.render(), (row) => row.type === 'fieldset').props.disabled, true);
  find(f.render(), (row) => row.type === 'Dialog').props.onOpenChange(false); assert.deepEqual(f.saved, []);
  f.destroy(); waiting.resolve({ id: 'plan-1' }); await Promise.all([first, second]); assert.deepEqual(f.saved, []);
});
test('报工空数量不会转成0；放弃草稿前需确认', async () => {
  const f = fixture({ action: 'report', task: { id: 'task-1', name: '装配', line: '一线', ownerName: '甲', unit: '件' } });
  change(f, '报工说明', '现场登记'); await submit(f);
  assert.equal(f.writes.length, 0); assert.ok(find(f.render(), (row) => row.props?.role === 'alert'));
  find(f.render(), (row) => row.type === 'Dialog').props.onOpenChange(false);
  assert.equal(find(f.render(), (row) => row.type === 'AlertDialog').props.open, true); assert.deepEqual(f.saved, []);
});
test('处置提交原异常号与记录版本，不提供客户端身份或关闭状态', async () => {
  const f = fixture({ action: 'disposition', quality: { id: 'q1', updatedAt: '2026-09-16T01:00:00.000Z', disposition: 'pending' } });
  change(f, '处置方式', 'rework'); change(f, '操作依据与原因', '返工完成，等待复验'); await submit(f);
  assert.equal(f.writes[0].data.qualityId, 'q1'); assert.equal(f.writes[0].data.baseUpdatedAt, '2026-09-16T01:00:00.000Z');
  assert.equal(f.writes[0].data.status, undefined); assert.equal(f.writes[0].data.actorId, undefined);
});
