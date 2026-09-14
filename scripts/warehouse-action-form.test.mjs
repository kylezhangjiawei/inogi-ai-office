import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
const source = (file) => readFileSync(new URL(`../src/app/procurement/warehouse/${file}`, import.meta.url), 'utf8');
const compile = (value) => ts.transpileModule(value, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
const types = {}, model = {};
new Function('exports', compile(source('warehouseTypes.ts')))(types);
new Function('exports', compile(source('warehousePreviewModel.ts')))(model);
const code = compile(source('WarehouseActionForm.tsx'));
const jsx = (type, props) => typeof type === 'function' ? type(props) : { type, props };
const components = new Proxy({}, { get: (_, name) => name });
const t = (value, params = {}) => value.replace(/\{(\w+)\}/g, (match, name) => params[name] ?? match);
const elements = (tree) => Array.isArray(tree) ? tree.flatMap(elements) : tree && typeof tree === 'object' ? [...(tree.type ? [tree] : []), ...Object.values(tree.props ?? {}).flatMap(elements)] : [];
const text = (tree) => Array.isArray(tree) ? tree.map(text).join(' ') : typeof tree === 'string' || typeof tree === 'number' ? String(tree) : tree && typeof tree === 'object' ? text(tree.props?.children) : '';
const deferred = () => { let resolve; const promise = new Promise((yes) => { resolve = yes; }); return { resolve, promise }; };
function contextFor(kind) {
  const state = model.createWarehouseState();
  const lot = state.lots.find((item) => item.id === 'demo-lot-valve-a');
  const issue = state.issues.find((item) => item.id === (kind === 'sign' ? 'demo-issue-pending' : 'demo-issue-signed'));
  const returned = state.returns.find((item) => item.id === 'demo-return-defective');
  const count = state.counts.find((item) => item.id === 'demo-count-draft');
  if (kind === 'return_resubmit') returned.status = 'discrepancy';
  if (kind === 'count_approve' || kind === 'count_reject') count.status = 'pending_review';
  return { kind, state, lotId: lot.id, ...(kind === 'issue' ? { dispatchId: 'demo-dispatch-valve' } : {}), ...(['sign', 'return_create'].includes(kind) ? { issueId: issue.id } : {}), ...(kind.startsWith('return_') && kind !== 'return_create' ? { returnId: returned.id } : {}), ...(kind.startsWith('count_') && kind !== 'count_create' ? { countId: count.id } : {}) };
}
function fixture({ kind = 'issue', context = contextFor(kind), submit, props: overrides = {} } = {}) {
  const slots = [], submissions = [], dirtyChanges = [], focused = [], scrolled = [];
  let cursor = 0, effects = [], tree, cancelled = 0;
  const same = (a, b) => Boolean(a && b && a.length === b.length && a.every((value, i) => Object.is(value, b[i])));
  const react = {
    useState(initial) { const i = cursor++; if (!(i in slots)) slots[i] = typeof initial === 'function' ? initial() : initial; return [slots[i], (value) => { slots[i] = typeof value === 'function' ? value(slots[i]) : value; }]; },
    useRef(initial) { const i = cursor++; return slots[i] ??= { current: initial }; },
    useEffect(callback, deps) { const i = cursor++, previous = slots[i]; if (!same(previous?.deps, deps)) effects.push(() => { previous?.cleanup?.(); slots[i] = { deps, cleanup: callback() }; }); },
  };
  const props = { context, onSubmit: async (input) => { submissions.push(input); await submit?.(input); }, onDirtyChange: (dirty) => dirtyChanges.push(dirty), onCancel: () => { cancelled++; }, ...overrides };
  const dependencies = { react, 'react/jsx-runtime': { jsx, jsxs: jsx, Fragment: 'Fragment' }, '../../lib/i18n': { useI18n: () => ({ t }), i18nLocale: () => 'zh-CN' }, '../../components/ui/utils': { cn: (...parts) => parts.filter(Boolean).join(' ') }, './warehouseTypes': types, './warehousePreviewModel': model };
  const exports = {};
  new Function('exports', 'require', code)(exports, (name) => {
    if (name in dependencies) return dependencies[name];
    if (name.endsWith('.css')) return {};
    assert.ok(name === 'lucide-react' || name.startsWith('../../components/ui/'), `No external write dependency: ${name}`);
    return components;
  });
  const view = {
    props, submissions, dirtyChanges, focused, scrolled, cancelled: () => cancelled,
    render() {
      const previousOpen = elements(tree).find((node) => node.type === 'AlertDialog')?.props.open;
      cursor = 0; effects = []; tree = exports.WarehouseActionForm(props);
      const dom = (node) => node ? { focus() { focused.push(node.props.id ?? node.type); }, scrollIntoView(options) { scrolled.push({ id: node.props.id, options }); }, querySelector(selector) { return dom(elements(tree).find((item) => `#${item.props?.id}` === selector)); } } : null;
      for (const node of elements(tree)) if (node.props?.ref) node.props.ref.current = dom(node);
      effects.forEach((job) => job()); effects = [];
      if (previousOpen && !view.node('AlertDialog').props.open) view.node('AlertDialogContent').props.onCloseAutoFocus({ preventDefault() {} });
      return tree;
    },
    async settle() { await new Promise((resolve) => setImmediate(resolve)); return view.render(); },
    unmount() { slots.forEach((slot) => slot?.cleanup?.()); },
    text: () => text(tree), nodes: () => elements(tree), node: (type) => elements(tree).find((node) => node.type === type),
    field: (name) => elements(tree).find((node) => node.props?.id === `warehouse-action-${name}`),
    button: (label) => elements(tree).find((node) => ['Button', 'AlertDialogAction', 'AlertDialogCancel'].includes(node.type) && text(node).trim() === label),
    fill(name, value) { const node = view.field(name); assert.ok(node, `${name} exists`); assert.equal(Boolean(node.props.disabled), false); node.props.onChange({ target: { value } }); return view.render(); },
    choose(name, value) { const node = view.nodes().find((item) => item.type === 'Select' && elements(item).some((child) => child.props?.id === `warehouse-action-${name}`)); assert.ok(node, `${name} selectable`); assert.equal(Boolean(node.props.disabled), false); node.props.onValueChange(value); return view.render(); },
    submit() { view.node('form').props.onSubmit({ preventDefault() {} }); return view.render(); },
    confirm() { const action = view.button('确认保存演示记录'); assert.ok(action); assert.equal(Boolean(action.props.disabled), false); action.props.onClick({ preventDefault() {} }); return view.render(); },
    cancelConfirmation() { view.node('AlertDialog').props.onOpenChange(false); return view.render(); },
    setProps(patch) { Object.assign(props, patch); return view.render(); },
  };
  view.render(); return view;
}

function fillValid(view) {
  const kind = view.props.context.kind;
  if (kind === 'issue') { view.choose('lotId', 'demo-lot-valve-a'); view.fill('quantity', '20'); }
  if (kind === 'sign') view.fill('actualQty', '20');
  if (kind === 'return_create') { view.fill('quantity', '4'); view.choose('result', 'inspection'); }
  if (kind === 'return_receive') { view.fill('actualQty', '6'); view.choose('result', 'defective'); }
  if (kind === 'return_discrepancy') view.fill('actualQty', '5');
  if (kind === 'return_resubmit') view.fill('quantity', '5');
  if (kind === 'count_create') { view.choose('bucket', 'qualified'); view.fill('actualQty', '198'); }
  if (kind === 'count_edit') view.fill('actualQty', '197');
  view.choose('actor', kind === 'count_approve' || kind === 'count_reject' ? '演示复核人' : '演示仓管员');
  view.fill('note', ' 核对本批数量和状态后登记。 ');
  if (view.field('evidence')) view.fill('evidence', ' 演示核对单 CHECK-001 ');
}

test('11种操作确认后提交正确字段，调用真实演示模型成功并清除草稿标记', async () => {
  const expected = {
    issue: ['kind', 'dispatchId', 'lotId', 'quantity', 'actor', 'note'], sign: ['kind', 'issueId', 'actualQty', 'actor', 'note'],
    return_create: ['kind', 'issueId', 'quantity', 'result', 'actor', 'note', 'evidence'], return_receive: ['kind', 'returnId', 'actualQty', 'result', 'reviewed', 'actor', 'note', 'evidence'],
    return_discrepancy: ['kind', 'returnId', 'actualQty', 'actor', 'note'], return_resubmit: ['kind', 'returnId', 'quantity', 'actor', 'note'],
    count_create: ['kind', 'lotId', 'bucket', 'actualQty', 'actor', 'note', 'evidence'], count_edit: ['kind', 'countId', 'actualQty', 'actor', 'note', 'evidence'],
    count_submit: ['kind', 'countId', 'actor', 'note'], count_approve: ['kind', 'countId', 'actor', 'note'], count_reject: ['kind', 'countId', 'actor', 'note'],
  };
  for (const kind of Object.keys(types.warehouseActionLabels)) {
    const context = contextFor(kind); let updated;
    const view = fixture({ kind, context, submit: (action) => { updated = model.applyWarehouseAction(context.state, context.state.version, action); } });
    fillValid(view); view.submit(); assert.equal(view.node('AlertDialog').props.open, true, kind); assert.equal(view.submissions.length, 0);
    view.confirm(); await view.settle(); assert.equal(view.submissions.length, 1, kind); assert.equal(updated.version, context.state.version + 1, kind);
    assert.deepEqual(Object.keys(view.submissions[0]).sort(), expected[kind].sort());
    for (const value of Object.values(view.submissions[0])) if (typeof value === 'string') assert.equal(value, value.trim());
    assert.equal(view.node('AlertDialog').props.open, false); assert.equal(view.dirtyChanges.at(-1), false); assert.match(view.text(), /演示记录已保存/);
  }
});

test('输入校验聚焦第一个无效字段，填字段时不抢焦点', () => {
  const view = fixture(); view.submit(); assert.equal(view.focused.at(-1), 'warehouse-action-quantity');
  const count = view.focused.length; view.fill('quantity', '20'); assert.equal(view.focused.length, count);
  view.submit(); assert.equal(view.focused.at(-1), 'warehouse-action-actor'); assert.equal(view.field('actor').props['aria-invalid'], true);
  assert.match(view.field('actor').props['aria-describedby'], /actor-error/); assert.equal(view.scrolled.at(-1).id, 'warehouse-action-actor');
});

test('发料拒绝非正数、指数、超精度、非数以及超大数', () => {
  const view = fixture(); fillValid(view);
  for (const value of ['', '0', '-1', '1e0', '1.0001', 'NaN', 'Infinity', '9007199254741']) {
    view.fill('quantity', value); view.submit(); assert.equal(view.node('AlertDialog').props.open, false, value); assert.equal(view.field('quantity').props['aria-invalid'], true, value);
  }
  view.fill('quantity', '0.001'); view.submit(); assert.equal(view.node('AlertDialog').props.open, true);
});

test('发料批次必须同物料同单位，数量不超过需求和未预留可用，确认含BOM换算', () => {
  const view = fixture(); fillValid(view); view.choose('lotId', 'demo-lot-screen'); view.submit(); assert.equal(view.field('lotId').props['aria-invalid'], true);
  view.choose('lotId', 'demo-lot-valve-a'); view.fill('quantity', '61'); view.submit(); assert.match(view.text(), /剩余需求 60 件/);
  view.choose('lotId', 'demo-lot-valve-b'); view.fill('quantity', '41'); view.submit(); assert.match(view.text(), /未预留可用 40 件/);
  view.fill('quantity', '40'); view.submit(); assert.equal(view.node('AlertDialog').props.open, true);
  assert.match(view.text(), /60\s+组件\s+×\s+2\s+件\s+=\s+120 件/);
});

test('缺少BOM版本、单耗或换算不一致时阻止发料', () => {
  for (const patch of [{ bomVersion: '' }, { qtyPer: null }, { requiredQty: null }, { requiredQty: 119 }, { qtyPer: 0 }]) {
    const context = contextFor('issue'); Object.assign(context.state.dispatches[0], patch);
    const view = fixture({ context }); fillValid(view); view.submit(); assert.equal(view.button('保存演示记录').props.disabled, true); assert.equal(view.node('AlertDialog').props.open, false); assert.match(view.text(), /BOM 单耗或需求数量未确认/);
  }
});

test('签收差异允许记录零实收，数量一致才计入线边且不重复扣仓库', async () => {
  const context = contextFor('sign'); let state;
  const view = fixture({ context, submit: (action) => { state = model.applyWarehouseAction(context.state, context.state.version, action); } }); fillValid(view); view.fill('actualQty', '0'); view.submit();
  assert.match(text(view.node('AlertDialogContent')), /签收差异.*均不改变/); view.confirm(); await view.settle();
  assert.equal(state.issues.find((item) => item.id === context.issueId).status, 'discrepancy'); assert.equal(state.lots[0].qualified, 200);
});

test('退料申请扣除其他申请预占，可退14件，拒绝超额及无质量状态', () => {
  const view = fixture({ kind: 'return_create' }); fillValid(view); assert.match(view.text(), /可退额度\s+14 件/);
  view.fill('quantity', '14.001'); view.submit(); assert.equal(view.field('quantity').props['aria-invalid'], true);
  view.fill('quantity', '14'); view.choose('result', 'invalid'); view.submit(); assert.equal(view.field('result').props['aria-invalid'], true);
  view.choose('result', 'inspection'); view.submit(); assert.equal(view.node('AlertDialog').props.open, true);
});

test('退料接收不能用不一致数量替代差异流程，合格接收须明确复核', () => {
  const view = fixture({ kind: 'return_receive' }); fillValid(view); view.fill('actualQty', '5'); view.submit(); assert.match(view.text(), /请使用“退回核对”/);
  view.fill('actualQty', '6'); view.choose('result', 'qualified'); view.submit(); assert.equal(view.field('reviewed').props['aria-invalid'], true);
  view.choose('reviewed', 'no'); view.submit(); assert.equal(view.field('reviewed').props['aria-invalid'], true);
  view.choose('reviewed', 'yes'); view.submit(); assert.equal(view.node('AlertDialog').props.open, true); assert.match(text(view.node('AlertDialogContent')), /已完成质量复核/);
});

test('差异接收零实物可记录，数量一致则引导直接接收', () => {
  const view = fixture({ kind: 'return_discrepancy' }); fillValid(view); view.fill('actualQty', '6'); view.submit(); assert.equal(view.field('actualQty').props['aria-invalid'], true);
  view.fill('actualQty', '0'); view.submit(); assert.equal(view.node('AlertDialog').props.open, true);
});

test('更正退料额度排除本单但保留其他申请预占', () => {
  const view = fixture({ kind: 'return_resubmit' }); fillValid(view); assert.match(view.text(), /可退额度\s+20 件/);
  view.fill('quantity', '20.001'); view.submit(); assert.equal(view.field('quantity').props['aria-invalid'], true);
  view.fill('quantity', '20'); view.submit(); assert.equal(view.node('AlertDialog').props.open, true);
});

test('盘点可保存少于预留的真实草稿，但警示不能直接提交复核', async () => {
  for (const kind of ['count_create', 'count_edit']) {
    const context = contextFor(kind); let state;
    const view = fixture({ context, submit: (action) => { state = model.applyWarehouseAction(context.state, context.state.version, action); } }); fillValid(view); view.fill('actualQty', '0');
    assert.match(view.text(), /可先保存实际盘点草稿/); view.submit(); assert.equal(view.node('AlertDialog').props.open, true); view.confirm(); await view.settle();
    assert.equal(state.lots[0].qualified, 200); assert.equal(kind === 'count_create' ? state.counts.at(-1).actualQty : state.counts[0].actualQty, 0);
  }
});

test('盘点实盘小于预留时禁用提交和通过，仍可退回核对', () => {
  for (const kind of ['count_submit', 'count_approve']) {
    const context = contextFor(kind); context.state.counts[0].actualQty = 19;
    const view = fixture({ context }); fillValid(view); view.submit(); assert.equal(view.button('保存演示记录').props.disabled, true); assert.match(view.text(), /实盘合格数量少于已预留/);
  }
  const context = contextFor('count_reject'); context.state.counts[0].actualQty = 19;
  const view = fixture({ context }); fillValid(view); view.submit(); assert.equal(view.node('AlertDialog').props.open, true);
});

test('新盘点确认含库存状态与当前账面，非合格状态允许零盘点', () => {
  const view = fixture({ kind: 'count_create' }); fillValid(view); view.choose('bucket', 'inspection'); view.fill('actualQty', '0'); view.submit();
  assert.equal(view.node('AlertDialog').props.open, true); assert.match(text(view.node('AlertDialogContent')), /库存状态 待检/); assert.match(text(view.node('AlertDialogContent')), /当前账面 10 件/);
});

test('修改实盘明确重新建立当前快照，表单与确认均列原账面和当前账面', () => {
  const context = contextFor('count_edit'); context.state.lots[0].qualified = 190; context.state.lots[0].version++;
  const view = fixture({ context }); fillValid(view); assert.match(text(view.node('form')), /当前账面 190 件.*原账面 200 件/); view.submit();
  assert.match(text(view.node('AlertDialogContent')), /当前账面 190 件.*原账面 200 件/);
});

test('库存版本变化后盘点不可直接提交或通过，允许退回修改', () => {
  for (const kind of ['count_submit', 'count_approve']) {
    const context = contextFor(kind); context.state.lots[0].version++;
    const view = fixture({ context }); fillValid(view); view.submit(); assert.equal(view.node('AlertDialog').props.open, false); assert.match(view.text(), /库存已变化/);
  }
  const context = contextFor('count_reject'); context.state.lots[0].version++;
  const view = fixture({ context }); fillValid(view); view.submit(); assert.equal(view.node('AlertDialog').props.open, true);
});

test('通过和退回都要求独立复核人，并提供原盘点说明和依据供核对', () => {
  for (const kind of ['count_approve', 'count_reject']) {
    const view = fixture({ kind }); fillValid(view); view.choose('actor', '演示仓管员'); view.submit(); assert.equal(view.field('actor').props['aria-invalid'], true); assert.match(view.text(), /复核人须与盘点人不同/);
    assert.match(text(view.node('details')), /演示月度盘点.*DEMO-STOCKTAKE-001/);
    view.choose('actor', '演示复核人'); view.submit(); assert.equal(view.node('AlertDialog').props.open, true);
  }
});

test('错误状态不能通过表单越过动作限制', () => {
  for (const kind of ['sign', 'return_receive', 'return_resubmit', 'count_edit', 'count_submit', 'count_approve', 'count_reject']) {
    const context = contextFor(kind); context.state.issues.find((item) => item.id === (context.issueId ?? 'demo-issue-signed')).status = 'signed';
    context.state.returns.find((item) => item.id === (context.returnId ?? 'demo-return-defective')).status = 'received'; context.state.counts[0].status = 'approved';
    const view = fixture({ context }); fillValid(view); view.submit(); assert.equal(view.node('AlertDialog').props.open, false, kind); assert.equal(view.button('保存演示记录').props.disabled, true, kind);
  }
});

test('操作说明和依据必填且限制2000字，不提供附件上传', () => {
  const view = fixture({ kind: 'return_create' }); fillValid(view);
  for (const field of ['note', 'evidence']) {
    const previous = view.field(field).props.value;
    for (const value of [' ', '长'.repeat(2001)]) { view.fill(field, value); view.submit(); assert.equal(view.field(field).props['aria-invalid'], true); }
    view.fill(field, previous);
  }
  assert.match(view.text(), /文字说明或关联单据号，不提供附件上传/); assert.equal(view.nodes().some((node) => node.props?.type === 'file'), false);
});

test('确认期间版本变化阻止保存并保留填写', () => {
  const view = fixture(); fillValid(view); view.submit(); const context = { ...view.props.context, state: { ...view.props.context.state, version: 99 } };
  view.setProps({ context }); view.confirm(); assert.equal(view.submissions.length, 0); assert.match(view.text(), /当前库存或单据已变化/); assert.equal(view.field('quantity').props.value, '20');
});

test('切换操作或单据但未重挂载时拒绝旧表单提交', () => {
  const view = fixture(); fillValid(view); view.setProps({ context: { ...view.props.context, dispatchId: 'demo-dispatch-screen' } }); view.submit();
  assert.equal(view.submissions.length, 0); assert.equal(view.node('AlertDialog').props.open, false); assert.match(view.text(), /当前单据或操作已变化/);
});

test('失败保存保留草稿，显示错误并允许原数据重试', async () => {
  let fail = true;
  const view = fixture({ submit: async () => { if (fail) throw new Error('模拟失败，请重试'); } }); fillValid(view); view.submit(); view.confirm(); await view.settle();
  assert.equal(view.field('quantity').props.value, '20'); assert.equal(view.dirtyChanges.at(-1), true); assert.match(view.text(), /模拟失败，请重试/);
  fail = false; view.submit(); view.confirm(); await view.settle(); assert.equal(view.submissions.length, 2); assert.equal(view.dirtyChanges.at(-1), false);
});

test('忙碌期间阻止重复确认、取消及关闭弹窗', async () => {
  const pending = deferred(); const view = fixture({ submit: () => pending.promise }); fillValid(view); view.submit();
  const action = view.button('确认保存演示记录'); action.props.onClick({ preventDefault() {} }); action.props.onClick({ preventDefault() {} }); view.render();
  assert.equal(view.submissions.length, 1); assert.equal(view.node('form').props['aria-busy'], true);
  view.node('AlertDialog').props.onOpenChange(false); view.render(); assert.equal(view.node('AlertDialog').props.open, true); assert.equal(view.button('取消填写').props.disabled, true);
  pending.resolve(); await view.settle(); assert.equal(view.node('form').props['aria-busy'], false);
});

test('卸载后完成异步保存不会回写脏状态或显示结果', async () => {
  const pending = deferred(); const view = fixture({ submit: () => pending.promise }); fillValid(view); view.submit(); view.confirm();
  const count = view.dirtyChanges.length; view.unmount(); pending.resolve(); await new Promise((resolve) => setImmediate(resolve)); assert.equal(view.dirtyChanges.length, count);
});

test('取消确认保留草稿并恢复保存按钮焦点，取消填写由父页面决定去留', () => {
  const view = fixture(); fillValid(view); view.submit(); view.cancelConfirmation(); assert.equal(view.field('quantity').props.value, '20'); assert.equal(view.focused.at(-1), 'Button');
  view.button('取消填写').props.onClick(); assert.equal(view.cancelled(), 1);
});
