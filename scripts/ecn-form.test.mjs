import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

const source = (file) => readFileSync(new URL(`../src/app/production/ecn/${file}`, import.meta.url), 'utf8');
const compile = (value) => ts.transpileModule(value, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
const types = {}, model = {};
new Function('exports', compile(source('ecnTypes.ts')))(types);
new Function('exports', 'require', compile(source('ecnModel.ts')))(model, (name) => { assert.equal(name, './ecnTypes'); return types; });
const code = compile(source('EcnActionForm.tsx'));
const jsx = (type, props) => typeof type === 'function' ? type(props) : { type, props };
const components = new Proxy({}, { get: (_, name) => name });
const t = (value, params = {}) => value.replace(/\{(\w+)\}/g, (match, name) => params[name] ?? match);
const elements = (tree) => Array.isArray(tree) ? tree.flatMap(elements) : tree && typeof tree === 'object' ? [...(tree.type ? [tree] : []), ...Object.values(tree.props ?? {}).flatMap(elements)] : [];
const text = (tree) => Array.isArray(tree) ? tree.map(text).join(' ') : typeof tree === 'string' || typeof tree === 'number' ? String(tree) : tree && typeof tree === 'object' ? text(tree.props?.children) : '';
const deferred = () => { let resolve; const promise = new Promise((yes) => { resolve = yes; }); return { resolve, promise }; };
function initialState(ready = false) {
  const actors = [
    { id: 'line-a', name: '班组长 A', role: '生产班组长', team: 'production' },
    { id: 'quality-a', name: '质量员 A', role: '质量工程师', team: 'quality' },
    { id: 'engineer-a', name: '工程师 A', role: '工艺工程师', team: 'engineering' },
    { id: 'purchase-a', name: '采购员 A', role: '采购', team: 'purchase' },
  ];
  const impacts = [
    { id: 'impact-new', batchNo: 'B-NEW', planNo: 'PLAN-NEW', product: '工业设备', quantity: 20, unit: '台', range: '本批全部', applicability: 'apply', decision: '执行新版' },
    { id: 'impact-old', batchNo: 'B-OLD', planNo: 'PLAN-OLD', product: '工业设备', quantity: 10, unit: '台', range: '本批全部', applicability: 'retain', decision: '按旧版保留' },
  ];
  return { version: 1, actors, records: [{
    id: 'record-1', code: 'ECN-TEST-01', title: '控制板换版', status: 'published', publisher: '技术部', publishedAt: '2026-09-01T08:00:00Z', materialCode: 'PCB-1', materialName: '控制板', process: '组装', effectiveRule: '按批次适用', summary: '按审批范围执行', differences: [], impacts,
    documents: [
      { id: 'verification-new', code: 'VR-01', title: '新版验证报告', revision: 'A', kind: 'verification', status: 'published', summary: '已验证', facts: [], impactIds: ['impact-new'] },
      { id: 'verification-draft', code: 'VR-DRAFT', title: '草稿验证', revision: 'B', kind: 'verification', status: 'draft', summary: '', facts: [], impactIds: ['impact-new'] },
      { id: 'verification-other', code: 'VR-OTHER', title: '其他范围验证', revision: 'A', kind: 'verification', status: 'published', summary: '', facts: [], impactIds: ['impact-old'] },
      { id: 'drawing-new', code: 'DW-01', title: '新版图纸', revision: 'B', kind: 'drawing', status: 'published', summary: '', facts: [], impactIds: ['impact-new'] },
    ],
    legacyTargets: [
      { id: 'legacy-stock', kind: 'inventory', code: 'LOT-01', label: '旧库存', quantity: 40, unit: '件', oldVersion: 'A' },
      { id: 'legacy-wip', kind: 'wip', code: 'WIP-01', label: '在制品', quantity: 10, unit: '台', oldVersion: 'A' },
      { id: 'legacy-order', kind: 'purchase-order', code: 'PO-01', label: '旧采购订单', quantity: 60, unit: '件', oldVersion: 'A' },
    ], requiredActorIds: ['line-a'],
    acknowledgements: ready ? [{ id: 'ack-1', actorId: 'line-a', impactIds: ['impact-new', 'impact-old'], note: '已核对', at: '2026-09-02T08:00:00Z' }] : [],
    dispositions: ready ? ['legacy-stock', 'legacy-wip', 'legacy-order'].map((targetId) => ({ id: `d-${targetId}`, targetId, choice: 'retain', reason: '按审批保留', actorId: 'engineer-a', at: '2026-09-02T08:00:00Z' })) : [],
    tasks: [{ id: 'task-1', code: 'ECNT-01', impactId: 'impact-new', ownerId: 'line-a', dueDate: '2099-01-01', description: '核对治具版本', actorId: 'engineer-a', at: '2026-09-02T08:00:00Z', status: ready ? 'resolved' : 'open', ...(ready ? { resolution: '治具已确认', resolvedBy: 'line-a', resolvedAt: '2026-09-03T08:00:00Z' } : {}) }],
    verifications: ready ? [{ id: 'v-1', impactId: 'impact-new', result: 'passed', evidenceId: 'verification-new', note: '验证通过', actorId: 'quality-a', at: '2026-09-03T08:00:00Z' }] : [], events: [],
  }] };
}
function fixture({ kind = 'acknowledge', submit, props: overrides = {} } = {}) {
  const slots = [], submissions = [], dirtyChanges = [], focused = [];
  let cursor = 0, effects = [], tree, cancelled = 0;
  const same = (a, b) => Boolean(a && b && a.length === b.length && a.every((value, i) => Object.is(value, b[i])));
  const react = {
    useState(initial) { const i = cursor++; if (!(i in slots)) slots[i] = typeof initial === 'function' ? initial() : initial; return [slots[i], (value) => { slots[i] = typeof value === 'function' ? value(slots[i]) : value; }]; },
    useRef(initial) { const i = cursor++; return slots[i] ??= { current: initial }; },
    useEffect(callback, deps) { const i = cursor++, previous = slots[i]; if (!same(previous?.deps, deps)) effects.push(() => { previous?.cleanup?.(); slots[i] = { deps, cleanup: callback() }; }); },
  };
  const context = { kind, ...(kind === 'disposition' ? { targetId: 'legacy-stock' } : {}), ...(kind === 'resolve-task' ? { taskId: 'task-1' } : {}), ...(['feedback', 'verify'].includes(kind) ? { impactId: 'impact-new' } : {}) };
  const state = initialState(kind === 'archive');
  if (kind === 'verify') state.records[0].tasks = state.records[0].tasks.map((task) => ({ ...task, status: 'resolved', resolution: '治具已确认', resolvedBy: 'line-a', resolvedAt: '2026-09-03T08:00:00Z' }));
  const props = { state, recordId: 'record-1', actorId: ['verify', 'archive'].includes(kind) ? 'quality-a' : kind === 'disposition' ? 'engineer-a' : 'line-a', context, onSubmit: async (input) => { submissions.push(input); await submit?.(input); }, onDirtyChange: (value) => dirtyChanges.push(value), onCancel: () => { cancelled++; }, ...overrides };
  const dependencies = { react, 'react/jsx-runtime': { jsx, jsxs: jsx, Fragment: 'Fragment' }, '../../lib/i18n': { useI18n: () => ({ t }) }, './ecnTypes': types, './ecnModel': model };
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
      cursor = 0; effects = []; tree = exports.EcnActionForm(props);
      const dom = (node) => node ? { focus() { focused.push(node.props.id ?? node.type); }, scrollIntoView() {}, querySelector(selector) { return dom(elements(tree).find((item) => `#${item.props?.id}` === selector)); } } : null;
      for (const node of elements(tree)) if (node.props?.ref) node.props.ref.current = dom(node);
      effects.forEach((job) => job()); effects = [];
      if (previousOpen && !view.node('AlertDialog').props.open) view.node('AlertDialogContent').props.onCloseAutoFocus({ preventDefault() {} });
      return tree;
    },
    async settle() { await new Promise((resolve) => setImmediate(resolve)); return view.render(); },
    unmount() { slots.forEach((slot) => slot?.cleanup?.()); },
    text: () => text(tree), nodes: () => elements(tree), node: (type) => elements(tree).find((node) => node.type === type),
    field: (name) => elements(tree).find((node) => node.props?.id === `ecn-action-${name}`),
    button: (label) => elements(tree).find((node) => ['Button', 'AlertDialogAction', 'AlertDialogCancel'].includes(node.type) && text(node).trim() === label),
    fill(name, value) { const node = view.field(name); assert.ok(node, `${name} exists`); assert.equal(Boolean(node.props.disabled), false); node.props.onChange({ target: { value } }); return view.render(); },
    select(name, value) { const node = view.nodes().find((item) => item.type === 'Select' && elements(item).some((child) => child.props?.id === `ecn-action-${name}`)); assert.ok(node); assert.equal(Boolean(node.props.disabled), false); node.props.onValueChange(value); return view.render(); },
    check(index, checked = true) { const node = view.nodes().filter((item) => item.type === "Checkbox")[index]; assert.ok(node); assert.equal(Boolean(node.props.disabled), false); node.props.onCheckedChange(checked); return view.render(); },
    submit() { view.node('form').props.onSubmit({ preventDefault() {} }); return view.render(); },
    confirm() { const action = view.node('AlertDialogAction'); assert.equal(Boolean(action.props.disabled), false); action.props.onClick({ preventDefault() {} }); return view.render(); },
    cancelConfirmation() { view.node('AlertDialog').props.onOpenChange(false); return view.render(); },
    setProps(patch) { Object.assign(props, patch); return view.render(); },
  };
  view.render(); return view;
}
function fillValid(view) {
  const { kind } = view.props.context;
  if (kind === 'acknowledge') { view.check(0); view.check(1); view.check(2); view.fill('note', ' 已核对新旧批次范围。 '); }
  if (kind === 'disposition') { if (!view.props.context.targetId) view.select('targetId', 'legacy-stock'); view.select('choice', 'retain'); view.fill('reason', ' 按审批范围保留旧版使用。 '); }
  if (['feedback', 'verify'].includes(kind) && !view.props.context.impactId) view.select('impactId', 'impact-new');
  if (kind === 'feedback') { view.select('ownerId', 'engineer-a'); view.fill('dueDate', '2099-01-01'); view.fill('description', ' 请核对现场工艺卡适用版本。 '); }
  if (kind === 'resolve-task') view.fill('resolution', ' 已核对治具版本并保留依据。 ');
  if (kind === 'verify') { view.select('result', 'passed'); view.select('evidenceId', 'verification-new'); view.fill('note', ' 按已发布验证记录确认适用范围。 '); }
  if (kind === 'archive') view.fill('reason', ' 所有执行事项均已核对完成。 ');
}

test('六种动作均先确认后提交真实模型，只提交当前动作字段且保留原状态', async () => {
  const keys = { acknowledge: ['kind', 'actorId', 'reviewed', 'impactIds', 'note'], disposition: ['kind', 'actorId', 'targetId', 'choice', 'reason'], feedback: ['kind', 'actorId', 'impactId', 'ownerId', 'dueDate', 'description'], 'resolve-task': ['kind', 'actorId', 'taskId', 'resolution'], verify: ['kind', 'actorId', 'impactId', 'result', 'evidenceId', 'note'], archive: ['kind', 'actorId', 'reason'] };
  for (const kind of Object.keys(keys)) {
    let result; const view = fixture({ kind, submit: (input) => { result = model.applyEcnAction(view.props.state, view.props.recordId, 1, input); } }); fillValid(view); view.submit();
    assert.equal(view.node('AlertDialog').props.open, true, `${kind}: ${view.text()}`); assert.equal(view.submissions.length, 0); view.confirm(); await view.settle();
    assert.equal(result.version, 2, kind); assert.deepEqual(Object.keys(view.submissions[0]).sort(), keys[kind].sort()); assert.equal(view.submissions[0].actorId, view.props.actorId);
    assert.equal(view.props.state.records[0].events.length, 0); assert.equal(view.dirtyChanges.at(-1), false); assert.match(view.text(), /已保存|已生成|已归档/);
    assert.equal(view.nodes().find((node) => node.type === 'Button' && node.props.type === 'submit').props.disabled, true);
  }
});

test('已阅勾选和范围均必填，错误关联首个控件并聚焦', () => {
  const view = fixture(); view.submit(); assert.equal(view.focused.at(-1), 'ecn-action-reviewed'); assert.equal(view.field('reviewed').props['aria-invalid'], true); assert.equal(view.field('reviewed').props['aria-describedby'], 'ecn-action-reviewed-error');
  view.check(0); view.submit(); assert.equal(view.focused.at(-1), 'ecn-action-impactIds'); assert.equal(view.node('AlertDialog').props.open, false);
});

test('已阅范围包含保留旧版批次，说明已阅不代替执行验证', () => {
  const view = fixture(); view.check(0); view.check(2); view.submit(); assert.equal(view.node('AlertDialog').props.open, true); const summary = text(view.node('AlertDialogContent'));
  assert.match(summary, /B-OLD/); assert.match(summary, /保留旧版/); assert.match(summary, /已阅不代表执行验证通过/);
});

test('已阅重复覆盖由真实模型阻止，补充新范围可保存', () => {
  const state = initialState(); state.records[0].acknowledgements = [{ id: 'ack', actorId: 'line-a', impactIds: ['impact-new'], note: '', at: '2026-09-02T00:00:00Z' }];
  const view = fixture({ props: { state } }); view.check(0); view.check(1); view.submit(); assert.equal(view.node('AlertDialog').props.open, false);
  view.check(2); view.submit(); assert.equal(view.node('AlertDialog').props.open, true);
});

test('未指定处置对象时可以选择，切换对象清空旧选项并仅提供适用方式', () => {
  const view = fixture({ kind: 'disposition', props: { context: { kind: 'disposition' } } }); view.select('targetId', 'legacy-stock'); view.select('choice', 'scrap'); view.select('targetId', 'legacy-order');
  const choices = view.nodes().find((node) => node.type === 'Select' && elements(node).some((item) => item.props?.id === 'ecn-action-choice'));
  assert.equal(choices.props.value, ''); assert.doesNotMatch(text(choices), /报废处理|返工后按新版验证/); assert.match(text(choices), /协商变更订单/);
});

test('不允许通过旧选项越过对象处置范围，原因必填', () => {
  const view = fixture({ kind: 'disposition', props: { context: { kind: 'disposition' } } }); view.select('targetId', 'legacy-order'); view.select('choice', 'scrap'); view.submit();
  assert.equal(view.field('choice').props['aria-invalid'], true); assert.equal(view.field('reason').props['aria-invalid'], true); assert.equal(view.node('AlertDialog').props.open, false);
});

test('处置确认显示具体对象、决定与原因，并说明需要业务单据', () => {
  const view = fixture({ kind: 'disposition' }); fillValid(view); view.submit(); const summary = text(view.node('AlertDialogContent'));
  assert.match(summary, /LOT-01/); assert.match(summary, /按旧版保留使用/); assert.match(summary, /按审批范围保留旧版使用/); assert.match(summary, /仍需后续业务单据/);
});

test('反馈必须指定有效负责人、日期和问题说明', () => {
  const view = fixture({ kind: 'feedback' }); view.submit(); assert.equal(view.field('ownerId').props['aria-invalid'], true); assert.equal(view.field('dueDate').props['aria-invalid'], true); assert.equal(view.field('description').props['aria-invalid'], true);
  fillValid(view); view.select('ownerId', 'unknown'); view.submit(); assert.equal(view.node('AlertDialog').props.open, false);
});

test('反馈拒绝无效日期和过去日期，错误保留原填写', () => {
  const view = fixture({ kind: 'feedback' }); fillValid(view);
  for (const value of ['2026-02-30', '2026-13-01', 'bad-date', '2000-01-01']) { view.fill('dueDate', value); view.submit(); assert.equal(view.node('AlertDialog').props.open, false); assert.equal(view.field('dueDate').props['aria-invalid'], true, view.text()); assert.equal(view.field('dueDate').props.value, value); }
});

test('反馈可针对保留旧版范围，实际生成本地待办且不外发', async () => {
  let result; const view = fixture({ kind: 'feedback', props: { context: { kind: 'feedback' } }, submit: (action) => { result = model.applyEcnAction(view.props.state, 'record-1', 1, action); } }); fillValid(view); view.select('impactId', 'impact-old'); view.submit();
  assert.match(text(view.node('AlertDialogContent')), /不向外部发送通知/); view.confirm(); await view.settle(); assert.equal(result.records[0].tasks.length, 2); assert.equal(result.records[0].tasks.at(-1).status, 'open');
});

test('待办处理预填目标，处理结果必填，完成不代替验证', () => {
  const view = fixture({ kind: 'resolve-task' }); assert.equal(view.node('Select').props.value, 'task-1'); assert.match(view.text(), /核对治具版本/); view.submit(); assert.equal(view.field('resolution').props['aria-invalid'], true);
  fillValid(view); view.submit(); assert.match(text(view.node('AlertDialogContent')), /处理结果不代替质量执行验证/);
});

test('已完成待办不能再次关闭，其他普通岗位不能代替负责人处理', () => {
  const completed = initialState(true); const view = fixture({ kind: 'resolve-task', props: { state: completed } }); fillValid(view); view.submit(); assert.equal(view.node('AlertDialog').props.open, false);
  const other = fixture({ kind: 'resolve-task', props: { actorId: 'purchase-a' } }); fillValid(other); other.submit(); assert.match(other.text(), /待办负责人/); assert.equal(other.submissions.length, 0);
});

test('验证仅列执行新版批次，证据限已发布且覆盖该批次的验证单', () => {
  const view = fixture({ kind: 'verify' }); const selects = view.nodes().filter((node) => node.type === 'Select');
  assert.doesNotMatch(text(selects[0]), /B-OLD/); assert.match(text(selects[2]), /VR-01/); assert.doesNotMatch(text(selects[2]), /VR-DRAFT|VR-OTHER|DW-01/);
});

test('选择批次时清空之前的证据，不能保存草稿、其他范围或图纸作验证', () => {
  const view = fixture({ kind: 'verify', props: { context: { kind: 'verify' } } }); fillValid(view); view.select('impactId', 'impact-new');
  const evidenceSelect = () => view.nodes().find((node) => node.type === 'Select' && elements(node).some((item) => item.props?.id === 'ecn-action-evidenceId'));
  assert.equal(evidenceSelect().props.value, '');
  for (const id of ['verification-draft', 'verification-other', 'drawing-new']) { view.select('evidenceId', id); view.submit(); assert.equal(view.node('AlertDialog').props.open, false); assert.equal(view.field('evidenceId').props['aria-invalid'], true); }
});

test('从具体对象打开的处置、待办和适用范围固定带入，直接触发事件也无法串改对象', () => {
  for (const [kind, field, expected, alternate] of [['disposition', 'targetId', 'legacy-stock', 'legacy-order'], ['resolve-task', 'taskId', 'task-1', 'task-other'], ['feedback', 'impactId', 'impact-new', 'impact-old'], ['verify', 'impactId', 'impact-new', 'impact-old']]) {
    const view = fixture({ kind });
    const select = () => view.nodes().find((node) => node.type === 'Select' && elements(node).some((item) => item.props?.id === `ecn-action-${field}`));
    assert.equal(select().props.value, expected); assert.equal(select().props.disabled, true); assert.equal(view.field(field).props.disabled, true);
    select().props.onValueChange(alternate); view.render(); assert.equal(select().props.value, expected); assert.equal(view.dirtyChanges.at(-1), false);
    fillValid(view); view.submit(); assert.equal(view.node('AlertDialog').props.open, true, kind);
  }
});

test('验证结果必须明确选择，未通过记录可保存并显示实际结论', async () => {
  const view = fixture({ kind: 'verify' }); view.submit(); assert.equal(view.field('result').props['aria-invalid'], true); fillValid(view); view.select('result', 'failed'); view.submit();
  assert.match(text(view.node('AlertDialogContent')), /验证未通过/); view.confirm(); await view.settle(); assert.equal(view.submissions[0].result, 'failed');
});

test('当前批次存在未完成待办时不能登记验证通过，可如实记录未通过', () => {
  const view = fixture({ kind: 'verify', props: { state: initialState() } }); fillValid(view); view.submit();
  assert.equal(view.node('AlertDialog').props.open, false); assert.match(view.text(), /未完成的协同待办/);
  view.select('result', 'failed'); view.submit(); assert.equal(view.node('AlertDialog').props.open, true);
});

test('归档显示所有未满足条件并禁用保存，满足条件才允许确认', () => {
  const state = initialState(); const view = fixture({ kind: 'archive', props: { state } }); fillValid(view); view.submit();
  for (const message of model.getArchiveBlockers(state, 'record-1')) assert.ok(view.text().includes(message), message);
  assert.equal(view.button('归档变更').props.disabled, true); assert.equal(view.node('AlertDialog').props.open, false);
  const ready = fixture({ kind: 'archive' }); fillValid(ready); ready.submit(); assert.equal(ready.node('AlertDialog').props.open, true);
});

test('操作人只能来自父页面有效身份，岗位限制和未发布归档状态均阻止操作', () => {
  for (const props of [{ actorId: 'missing' }, { actorId: 'line-a' }]) { const view = fixture({ kind: 'verify', props }); fillValid(view); view.submit(); assert.equal(view.node('AlertDialog').props.open, false); assert.equal(view.field('actorId'), undefined); }
  for (const status of ['draft', 'archived']) { const state = initialState(); state.records[0].status = status; const view = fixture({ props: { state } }); fillValid(view); view.submit(); assert.equal(view.node('AlertDialog').props.open, false); }
});

test('只读禁用字段、勾选和保存，取消保持可用', () => {
  const view = fixture({ props: { readOnly: true } }); assert.equal(view.field('reviewed').props.disabled, true); view.submit(); assert.equal(view.node('AlertDialog').props.open, false); view.button('取消填写').props.onClick(); assert.equal(view.cancelled(), 1);
});

test('确认期间只读或身份变化会拒绝旧操作并保留输入', () => {
  for (const patch of [{ readOnly: true }, { actorId: 'purchase-a' }, { context: { kind: 'acknowledge', impactId: 'impact-old' } }, { recordId: 'missing' }]) {
    const view = fixture(); fillValid(view); view.submit(); view.setProps(patch); view.confirm(); assert.equal(view.submissions.length, 0); assert.equal(view.node('AlertDialog').props.open, false); assert.ok(view.field('note').props.value);
  }
});

test('确认前和确认期间数据版本变化均保留表单并阻止覆盖', () => {
  for (const confirming of [false, true]) { const view = fixture(); fillValid(view); if (confirming) view.submit(); view.setProps({ state: { ...view.props.state, version: 99 } }); if (confirming) view.confirm(); else view.submit(); assert.equal(view.submissions.length, 0); assert.match(view.text(), /变更记录已更新/); }
});

test('保存失败保留填写和脏状态，重试成功才清除', async () => {
  let fail = true; const view = fixture({ kind: 'feedback', submit: () => { if (fail) throw new Error('模拟保存失败，请重试'); } }); fillValid(view); view.submit(); view.confirm(); await view.settle();
  assert.match(view.text(), /模拟保存失败/); assert.equal(view.field('dueDate').props.value, '2099-01-01'); assert.equal(view.dirtyChanges.at(-1), true);
  fail = false; view.submit(); view.confirm(); await view.settle(); assert.equal(view.submissions.length, 2); assert.equal(view.dirtyChanges.at(-1), false);
});

test('忙碌同步防重复并锁定关闭，成功后不可重复提交', async () => {
  const pending = deferred(); const view = fixture({ submit: () => pending.promise }); fillValid(view); view.submit(); const action = view.node('AlertDialogAction'); action.props.onClick({ preventDefault() {} }); action.props.onClick({ preventDefault() {} }); view.render();
  assert.equal(view.submissions.length, 1); assert.equal(view.field('reviewed').props.disabled, true); assert.equal(view.node('form').props['aria-busy'], true); view.node('AlertDialog').props.onOpenChange(false); view.render(); assert.equal(view.node('AlertDialog').props.open, true);
  pending.resolve(); await view.settle(); assert.equal(view.node('form').props['aria-busy'], false); view.submit(); assert.equal(view.submissions.length, 1);
});

test('卸载后保存完成不回写父页面，取消确认保留填写和焦点', async () => {
  const pending = deferred(); const view = fixture({ submit: () => pending.promise }); fillValid(view); view.submit(); view.cancelConfirmation(); assert.equal(view.focused.at(-1), 'Button'); assert.ok(view.field('note').props.value);
  view.submit(); view.confirm(); const count = view.dirtyChanges.length; view.unmount(); pending.resolve(); await new Promise((resolve) => setImmediate(resolve)); assert.equal(view.dirtyChanges.length, count);
});

test('长说明就地校验，反馈 2000 字和普通说明 1000 字限制一致', () => {
  for (const [kind, field, limit] of [['feedback', 'description', 2000], ['verify', 'note', 1000], ['disposition', 'reason', 1000], ['resolve-task', 'resolution', 1000]]) {
    const view = fixture({ kind }); fillValid(view); view.fill(field, '长'.repeat(limit + 1)); view.submit(); assert.equal(view.field(field).props['aria-invalid'], true); assert.equal(view.field(field).props.maxLength, limit);
  }
});
