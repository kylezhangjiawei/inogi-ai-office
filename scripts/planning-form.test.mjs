import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
const source = (file) => readFileSync(new URL(`../src/app/production/planning/${file}`, import.meta.url), 'utf8');
const compile = (value) => ts.transpileModule(value, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
const types = {}, model = {};
new Function('exports', compile(source('planningTypes.ts')))(types);
new Function('exports', 'require', compile(source('planningModel.ts')))(model, (name) => { assert.equal(name, './planningTypes'); return types; });
const code = compile(source('PlanningActionForm.tsx'));
const jsx = (type, props) => typeof type === 'function' ? type(props) : { type, props };
const components = new Proxy({}, { get: (_, name) => name });
const t = (value, params = {}) => value.replace(/\{(\w+)\}/g, (match, name) => params[name] ?? match);
const elements = (tree) => Array.isArray(tree) ? tree.flatMap(elements) : tree && typeof tree === 'object' ? [...(tree.type ? [tree] : []), ...Object.values(tree.props ?? {}).flatMap(elements)] : [];
const text = (tree) => Array.isArray(tree) ? tree.map(text).join(' ') : typeof tree === 'string' || typeof tree === 'number' ? String(tree) : tree && typeof tree === 'object' ? text(tree.props?.children) : '';
const deferred = () => { let resolve; const promise = new Promise((yes) => { resolve = yes; }); return { resolve, promise }; };
function fixture({ kind = 'create', submit, props: overrides = {} } = {}) {
  const slots = [], submissions = [], dirtyChanges = [], focused = [];
  let cursor = 0, effects = [], tree, cancelled = 0;
  const same = (a, b) => Boolean(a && b && a.length === b.length && a.every((value, i) => Object.is(value, b[i])));
  const react = {
    useState(initial) { const i = cursor++; if (!(i in slots)) slots[i] = typeof initial === 'function' ? initial() : initial; return [slots[i], (value) => { slots[i] = typeof value === 'function' ? value(slots[i]) : value; }]; },
    useRef(initial) { const i = cursor++; return slots[i] ??= { current: initial }; },
    useEffect(callback, deps) { const i = cursor++, previous = slots[i]; if (!same(previous?.deps, deps)) effects.push(() => { previous?.cleanup?.(); slots[i] = { deps, cleanup: callback() }; }); },
  };
  const context = { kind, batchId: 'batch-new', ...(kind !== 'create' ? { taskId: kind === 'adjust' ? 'task-active' : 'task-draft' } : {}) };
  const props = { state: model.createPlanningState(), actorId: 'planner-a', context, onSubmit: async (input) => { submissions.push(input); await submit?.(input); }, onDirtyChange: (value) => dirtyChanges.push(value), onCancel: () => { cancelled++; }, ...overrides };
  const dependencies = { react, 'react/jsx-runtime': { jsx, jsxs: jsx, Fragment: 'Fragment' }, '../../lib/i18n': { useI18n: () => ({ t }), i18nLocale: () => 'zh-CN' }, '../../components/ui/utils': { cn: (...parts) => parts.filter(Boolean).join(' ') }, './planningTypes': types, './planningModel': model };
  const exports = {};
  new Function('exports', 'require', code)(exports, (name) => {
    if (/\/ui\/(?:button|input|native-select|textarea|checkbox|radio-group|slider)$/.test(name)) return { Button: "Button", Input: "Input", NativeSelect: "NativeSelect", Textarea: "Textarea", Checkbox: "Checkbox", RadioGroup: "RadioGroup", RadioGroupItem: "RadioGroupItem", Slider: "Slider" };

    if (name in dependencies) return dependencies[name]; if (name.endsWith('.css')) return {};
    assert.ok(name === 'lucide-react' || name.startsWith('../../components/ui/'), `No external write dependency: ${name}`); return components;
  });
  const view = {
    props, submissions, dirtyChanges, focused, cancelled: () => cancelled,
    render() {
      const previousOpen = elements(tree).find((node) => node.type === 'AlertDialog')?.props.open;
      cursor = 0; effects = []; tree = exports.PlanningActionForm(props);
      const dom = (node) => node ? { focus() { focused.push(node.props.id ?? node.type); }, scrollIntoView() {}, querySelector(selector) { return dom(elements(tree).find((item) => `#${item.props?.id}` === selector)); } } : null;
      for (const node of elements(tree)) if (node.props?.ref) node.props.ref.current = dom(node);
      effects.forEach((job) => job()); effects = [];
      if (previousOpen && !view.node('AlertDialog').props.open) view.node('AlertDialogContent').props.onCloseAutoFocus({ preventDefault() {} });
      return tree;
    },
    async settle() { await new Promise((resolve) => setImmediate(resolve)); return view.render(); },
    unmount() { slots.forEach((slot) => slot?.cleanup?.()); },
    text: () => text(tree), nodes: () => elements(tree), node: (type) => elements(tree).find((node) => node.type === type),
    field: (name) => elements(tree).find((node) => node.props?.id === `planning-action-${name}`),
    selectNode: (name) => elements(tree).find((node) => node.type === 'Select' && elements(node).some((child) => child.props?.id === `planning-action-${name}`)),
    button: (label) => elements(tree).find((node) => ['Button', 'AlertDialogAction', 'AlertDialogCancel'].includes(node.type) && text(node).trim() === label),
    fill(name, value) { const node = view.field(name); assert.ok(node, `${name} exists`); assert.equal(Boolean(node.props.disabled), false); node.props.onChange({ target: { value } }); return view.render(); },
    select(name, value) { const node = view.selectNode(name); assert.ok(node); assert.equal(Boolean(node.props.disabled), false); node.props.onValueChange(value); return view.render(); },
    check(checked = true) { const node = view.field('reviewed'); assert.ok(node); assert.equal(Boolean(node.props.disabled), false); node.props.onCheckedChange(checked); return view.render(); },
    submit() { view.node('form').props.onSubmit({ preventDefault() {} }); return view.render(); },
    confirm() { const action = view.node('AlertDialogAction'); assert.equal(Boolean(action.props.disabled), false); action.props.onClick({ preventDefault() {} }); return view.render(); },
    cancelConfirmation() { view.node('AlertDialog').props.onOpenChange(false); return view.render(); },
    setProps(patch) { Object.assign(props, patch); return view.render(); },
  };
  view.render(); return view;
}
function fillValid(view) {
  const { state, context } = view.props;
  if (context.kind === 'create') {
    const batch = state.batches.find((item) => item.id === context.batchId);
    const room = (operation) => operation.requiredQty - state.tasks.filter((task) => task.batchId === batch.id && task.operationId === operation.id && task.status !== 'cancelled').reduce((total, task) => total + task.quantity, 0);
    const operation = batch.operations.find((item) => room(item) > 0);
    assert.ok(operation, 'seed has a schedulable operation');
    view.select('operationId', operation.id); view.fill('date', batch.startDate); view.fill('quantity', String(Math.min(5, room(operation))));
    view.select('lineId', operation.lineIds[0]); view.select('ownerId', state.actors.find((person) => person.role === 'line' && person.lineId === operation.lineIds[0]).id);
    view.fill('note', ' 按批次安排组件任务。 ');
  }
  if (context.kind === 'adjust') { view.fill('note', ' 根据现场情况补充计划说明。 '); view.fill('reason', ' 已核对既有报工后调整安排。 '); }
  if (context.kind === 'dispatch') { view.check(); view.fill('note', ' 按计划备料并安排作业。 '); }
  if (context.kind === 'cancel') view.fill('reason', ' 该草稿计划重复录入，取消后保留记录。 ');
}

test('四种操作均先确认再调用真实模型，字段正确且不改写原状态', async () => {
  const keys = { create: ['kind', 'actorId', 'batchId', 'operationId', 'date', 'lineId', 'ownerId', 'quantity', 'note'], adjust: ['kind', 'actorId', 'taskId', 'date', 'lineId', 'ownerId', 'quantity', 'note', 'reason'], dispatch: ['kind', 'actorId', 'taskId', 'reviewed', 'note'], cancel: ['kind', 'actorId', 'taskId', 'reason'] };
  for (const kind of Object.keys(keys)) {
    let result; const view = fixture({ kind, submit: (action) => { result = model.applyPlanningAction(view.props.state, view.props.state.version, action); } }); const before = JSON.stringify(view.props.state); fillValid(view); view.submit();
    assert.equal(view.node('AlertDialog').props.open, true, `${kind}: ${view.text()}`); assert.equal(view.submissions.length, 0); view.confirm(); await view.settle();
    assert.equal(result.version, view.props.state.version + 1, kind); assert.deepEqual(Object.keys(view.submissions[0]).sort(), keys[kind].sort()); assert.equal(JSON.stringify(view.props.state), before);
    assert.equal(view.dirtyChanges.at(-1), false); assert.match(view.text(), /已保存|已生成|已取消/); assert.equal(view.nodes().find((node) => node.type === 'Button' && node.props.type === 'submit').props.disabled, true);
  }
});

test('新增批次固定且操作人不自由编辑，首个字段错误关联并聚焦', () => {
  const view = fixture(); assert.equal(view.field('batchId'), undefined); assert.equal(view.field('actorId'), undefined); view.submit();
  assert.equal(view.field('operationId').props['aria-invalid'], true); assert.equal(view.field('operationId').props['aria-describedby'], 'planning-action-operationId-error'); assert.equal(view.focused.at(-1), 'planning-action-operationId');
});

test('新建选择工序限制产线和线长，切换工序清空依赖选择', () => {
  const view = fixture(); fillValid(view); const operationId = view.selectNode('operationId').props.value;
  const batch = view.props.state.batches.find((item) => item.id === 'batch-new'), operation = batch.operations.find((item) => item.id === operationId);
  const lines = elements(view.selectNode('lineId')).filter((node) => node.type === 'SelectItem').map((node) => node.props.value);
  assert.deepEqual(lines.sort(), [...operation.lineIds].sort());
  const owners = elements(view.selectNode('ownerId')).filter((node) => node.type === 'SelectItem').map((node) => node.props.value);
  assert.ok(owners.every((id) => view.props.state.actors.some((person) => person.id === id && person.role === 'line' && person.lineId === view.selectNode('lineId').props.value)));
  view.select('operationId', operationId); assert.equal(view.selectNode('lineId').props.value, ''); assert.equal(view.selectNode('ownerId').props.value, '');
});

test('切换产线清空责任线长，不能提交跨线人员', () => {
  const view = fixture(); fillValid(view); const lineId = view.selectNode('lineId').props.value; view.select('lineId', lineId); assert.equal(view.selectNode('ownerId').props.value, '');
  view.select('ownerId', 'planner-a'); view.submit(); assert.equal(view.field('ownerId').props['aria-invalid'], true); assert.equal(view.node('AlertDialog').props.open, false);
});

test('拒绝非正整数及超出同工序剩余任务数量', () => {
  const view = fixture(); fillValid(view);
  for (const quantity of ['', '0', '-1', '1.5', '1.0', '1e2', 'NaN', '9007199254740992']) { view.fill('quantity', quantity); view.submit(); assert.equal(view.field('quantity').props['aria-invalid'], true, quantity); assert.equal(view.node('AlertDialog').props.open, false); }
  const operation = view.props.state.batches.find((item) => item.id === 'batch-new').operations.find((item) => item.id === view.selectNode('operationId').props.value);
  view.fill('quantity', String(operation.requiredQty + 1)); view.submit(); assert.equal(view.field('quantity').props['aria-invalid'], true);
});

test('日期按批次窗口校验，允许超交期但不超过可安排结束日', () => {
  const view = fixture(); fillValid(view); const batch = view.props.state.batches.find((item) => item.id === 'batch-new');
  assert.equal(view.field('date').props.min, batch.startDate); assert.equal(view.field('date').props.max, batch.endDate);
  for (const date of ['2026-02-30', '2000-01-01', '2099-01-01']) { view.fill('date', date); view.submit(); assert.equal(view.field('date').props['aria-invalid'], true, date); }
  view.fill('date', batch.endDate); view.submit(); assert.equal(view.node('AlertDialog').props.open, true);
});

test('调整固定任务和工序，不提供重新选批次或工序的字段', () => {
  const view = fixture({ kind: 'adjust' }); assert.equal(view.field('batchId'), undefined); assert.equal(view.field('taskId'), undefined); assert.equal(view.field('operationId'), undefined);
  fillValid(view); view.submit(); assert.equal(view.node('AlertDialog').props.open, true);
});

test('调整不能低于已报工事实且必须填写原因', () => {
  const view = fixture({ kind: 'adjust' }); const task = view.props.state.tasks.find((item) => item.id === 'task-active'); assert.ok(task.reported > 0);
  view.fill('quantity', String(Math.max(0, task.reported - 1))); view.submit(); assert.equal(view.field('quantity').props['aria-invalid'], true); assert.equal(view.field('reason').props['aria-invalid'], true);
});

test('调整确认列出前后数量日期产线和原因，已报工事实保持原样', async () => {
  let result; const view = fixture({ kind: 'adjust', submit: (action) => { result = model.applyPlanningAction(view.props.state, view.props.state.version, action); } }); const task = view.props.state.tasks.find((item) => item.id === 'task-active'); fillValid(view); view.submit();
  const summary = text(view.node('AlertDialogContent')); assert.match(summary, /原计划/); assert.match(summary, /本次计划/); assert.match(summary, /既有报工/); assert.match(summary, /已报工/); assert.match(summary, /调整原因/);
  view.confirm(); await view.settle(); const updated = result.tasks.find((item) => item.id === task.id);
  for (const key of ['reported', 'qualified', 'rework', 'actualDate', 'actualLineId']) assert.equal(updated[key], task[key]);
});

test('派工必须先核对，用料数量来自计划数量与单耗，派工不冒充已配料或开工', async () => {
  let result; const view = fixture({ kind: 'dispatch', submit: (action) => { result = model.applyPlanningAction(view.props.state, view.props.state.version, action); } }); view.submit(); assert.equal(view.field('reviewed').props['aria-invalid'], true); fillValid(view); view.submit();
  const summary = text(view.node('AlertDialogContent')); assert.match(summary, /本页生成派工与用料需求，不代表已配料、已开工/); assert.match(summary, /将生成的用料需求/); view.confirm(); await view.settle();
  assert.equal(result.dispatches.length, view.props.state.dispatches.length + 1); assert.equal(result.materialRequests.length, view.props.state.materialRequests.length + 1);
  const request = result.materialRequests.find((item) => item.taskId === 'task-draft'); assert.ok(request.lines.every((line) => line.issued === 0));
});

test('派工资料未发布时拒绝确认并显示明确错误', () => {
  const state = model.createPlanningState(), task = state.tasks.find((item) => item.id === 'task-draft'); const operation = state.batches.find((item) => item.id === task.batchId).operations.find((item) => item.id === task.operationId);
  operation.documents = operation.documents.map((document) => ({ ...document, status: 'pending' }));
  const view = fixture({ kind: 'dispatch', props: { state } }); fillValid(view); view.submit(); assert.equal(view.node('AlertDialog').props.open, false); assert.equal(view.submissions.length, 0);
});

test('派工发现原计划产线或工序失效时，错误显示在表单内而非不存在的控件', () => {
  for (const [field, value, expected] of [['ownerId', 'planner-a', /负责人须为所选产线的线长/], ['operationId', 'missing', /有效工序/]]) {
    const state = model.createPlanningState(); state.tasks.find((item) => item.id === 'task-draft')[field] = value;
    const view = fixture({ kind: 'dispatch', props: { state } }); fillValid(view); view.submit(); assert.equal(view.node('AlertDialog').props.open, false); assert.match(view.text(), expected); assert.equal(view.field(field), undefined);
  }
});

test('调整草稿也要求填写调整原因，确认摘要和历史保持一致', () => {
  const view = fixture({ kind: 'adjust', props: { context: { kind: 'adjust', batchId: 'batch-new', taskId: 'task-draft' } } }); view.fill('note', '更新草稿说明'); view.submit();
  assert.equal(view.field('reason').props['aria-invalid'], true); assert.equal(view.node('AlertDialog').props.open, false);
});

test('取消仅允许待派工草稿，需要原因并使用危险确认动作', () => {
  const view = fixture({ kind: 'cancel' }); view.submit(); assert.equal(view.field('reason').props['aria-invalid'], true); fillValid(view); view.submit();
  assert.equal(view.node('AlertDialog').props.open, true); assert.match(view.node('AlertDialogAction').props.className, /bg-destructive/); assert.match(text(view.node('AlertDialogContent')), /取消原因/);
  const active = fixture({ kind: 'cancel', props: { context: { kind: 'cancel', batchId: 'batch-new', taskId: 'task-active' } } }); fillValid(active); active.submit(); assert.equal(active.node('AlertDialog').props.open, false); assert.match(active.text(), /只有未派工任务可以取消/);
});

test('只读、线长、已关闭批次以及已完成任务不能保存', () => {
  const readonly = fixture({ props: { readOnly: true } }); assert.equal(readonly.field('date').props.disabled, true); readonly.submit(); assert.equal(readonly.node('AlertDialog').props.open, false); readonly.button('取消填写').props.onClick(); assert.equal(readonly.cancelled(), 1);
  const state = model.createPlanningState(), lineActor = state.actors.find((person) => person.role === 'line'); const line = fixture({ props: { actorId: lineActor.id } }); fillValid(line); line.submit(); assert.equal(line.node('AlertDialog').props.open, false);
  state.batches.find((item) => item.id === 'batch-new').status = 'closed'; const closed = fixture({ props: { state } }); fillValid(closed); closed.submit(); assert.equal(closed.node('AlertDialog').props.open, false);
  const completedState = model.createPlanningState(); completedState.tasks.find((item) => item.id === 'task-active').status = 'completed'; const completed = fixture({ kind: 'adjust', props: { state: completedState } }); fillValid(completed); completed.submit(); assert.equal(completed.node('AlertDialog').props.open, false);
});

test('上下文批次与任务不一致时拒绝保存，固定操作人切换不串提交', () => {
  const view = fixture({ kind: 'adjust' }); fillValid(view); view.submit(); view.setProps({ actorId: 'supervisor-a' }); view.confirm(); assert.equal(view.submissions.length, 0); assert.match(view.text(), /当前批次、任务或操作人已变化/);
  const state = model.createPlanningState(); state.tasks.find((item) => item.id === 'task-active').batchId = 'another-batch'; const wrong = fixture({ kind: 'adjust', props: { state } }); fillValid(wrong); wrong.submit(); assert.equal(wrong.node('AlertDialog').props.open, false); assert.match(wrong.text(), /任务不属于当前批次/);
});

test('数据版本或任务修订变化会阻止旧表单，保留填写', () => {
  for (const change of ['state', 'task']) { const view = fixture({ kind: 'adjust' }); fillValid(view); view.submit(); if (change === 'state') view.setProps({ state: { ...view.props.state, version: 99 } }); else { view.props.state.tasks.find((item) => item.id === 'task-active').revision += 1; view.render(); } view.confirm(); assert.equal(view.submissions.length, 0); assert.match(view.text(), /计划记录已更新/); assert.ok(view.field('reason').props.value); }
});

test('确认期间变为只读或切换任务，不会提交旧数据', () => {
  for (const patch of [{ readOnly: true }, { context: { kind: 'adjust', batchId: 'batch-new', taskId: 'task-draft' } }]) { const view = fixture({ kind: 'adjust' }); fillValid(view); view.submit(); view.setProps(patch); view.confirm(); assert.equal(view.submissions.length, 0); assert.equal(view.node('AlertDialog').props.open, false); }
});

test('失败保留全部填写和脏状态，重试成功后才清除', async () => {
  let fail = true; const view = fixture({ submit: () => { if (fail) throw new Error('模拟计划保存失败，请重试'); } }); fillValid(view); const original = view.field('quantity').props.value; view.submit(); view.confirm(); await view.settle();
  assert.match(view.text(), /模拟计划保存失败/); assert.equal(view.field('quantity').props.value, original); assert.equal(view.dirtyChanges.at(-1), true);
  fail = false; view.submit(); view.confirm(); await view.settle(); assert.equal(view.submissions.length, 2); assert.equal(view.dirtyChanges.at(-1), false);
});

test('忙碌同步防重复，确认中的字段回调不能改值，保存成功不可再次提交', async () => {
  const pending = deferred(); const view = fixture({ submit: () => pending.promise }); fillValid(view); const field = view.field('quantity'), original = field.props.value; view.submit();
  view.field('quantity').props.onChange({ target: { value: '999' } }); view.render(); assert.equal(view.field('quantity').props.value, original);
  const action = view.node('AlertDialogAction'); action.props.onClick({ preventDefault() {} }); action.props.onClick({ preventDefault() {} }); view.render(); assert.equal(view.submissions.length, 1); assert.equal(view.node('form').props['aria-busy'], true);
  view.node('AlertDialog').props.onOpenChange(false); view.render(); assert.equal(view.node('AlertDialog').props.open, true); pending.resolve(); await view.settle(); view.submit(); assert.equal(view.submissions.length, 1);
});

test('取消确认恢复焦点并保留填写，卸载后保存完成不通知旧父页面', async () => {
  const pending = deferred(); const view = fixture({ submit: () => pending.promise }); fillValid(view); view.submit(); view.cancelConfirmation(); assert.equal(view.focused.at(-1), 'Button'); assert.ok(view.field('note').props.value);
  view.submit(); view.confirm(); const count = view.dirtyChanges.length; view.unmount(); pending.resolve(); await new Promise((resolve) => setImmediate(resolve)); assert.equal(view.dirtyChanges.length, count);
});
