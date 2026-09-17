import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
const source = (file) => readFileSync(new URL(`../src/app/procurement/shipments/${file}`, import.meta.url), 'utf8');
const compile = (value) => ts.transpileModule(value, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
const types = {}, model = {};
new Function('exports', compile(source('shipmentTypes.ts')))(types);
new Function('exports', compile(source('shipmentPreviewModel.ts')))(model);
const code = compile(source('ShipmentActionForm.tsx'));
const jsx = (type, props) => typeof type === 'function' ? type(props) : { type, props };
const components = new Proxy({}, { get: (_, name) => name });
const t = (value, params = {}) => value.replace(/\{(\w+)\}/g, (match, name) => params[name] ?? match);
const elements = (tree) => Array.isArray(tree) ? tree.flatMap(elements) : tree && typeof tree === 'object' ? [...(tree.type ? [tree] : []), ...Object.values(tree.props ?? {}).flatMap(elements)] : [];
const text = (tree) => Array.isArray(tree) ? tree.map(text).join(' ') : typeof tree === 'string' || typeof tree === 'number' ? String(tree) : tree && typeof tree === 'object' ? text(tree.props?.children) : '';
const deferred = () => { let resolve; const promise = new Promise((yes) => { resolve = yes; }); return { resolve, promise }; };
function contextFor(kind) {
  return { kind, state: model.createShipmentState(), ...(kind !== 'create' ? { recordId: ['edit', 'confirm'].includes(kind) ? 'ship-draft' : 'ship-80' } : {}) };
}

function fixture({ kind = 'create', context = contextFor(kind), submit, props: overrides = {} } = {}) {
  const slots = [], submissions = [], dirtyChanges = [], focused = [], scrolled = [];
  let cursor = 0, effects = [], tree, cancelled = 0;
  const same = (a, b) => Boolean(a && b && a.length === b.length && a.every((value, i) => Object.is(value, b[i])));
  const react = {
    useState(initial) { const i = cursor++; if (!(i in slots)) slots[i] = typeof initial === 'function' ? initial() : initial; return [slots[i], (value) => { slots[i] = typeof value === 'function' ? value(slots[i]) : value; }]; },
    useRef(initial) { const i = cursor++; return slots[i] ??= { current: initial }; },
    useEffect(callback, deps) { const i = cursor++, previous = slots[i]; if (!same(previous?.deps, deps)) effects.push(() => { previous?.cleanup?.(); slots[i] = { deps, cleanup: callback() }; }); },
  };
  const props = { context, onSubmit: async (input) => { submissions.push(input); await submit?.(input); }, onDirtyChange: (dirty) => dirtyChanges.push(dirty), onCancel: () => { cancelled++; }, ...overrides };
  const dependencies = { react, 'react/jsx-runtime': { jsx, jsxs: jsx, Fragment: 'Fragment' }, '../../lib/i18n': { useI18n: () => ({ t }), i18nLocale: () => 'zh-CN' }, '../../components/ui/utils': { cn: (...parts) => parts.filter(Boolean).join(' ') }, './shipmentTypes': types, './shipmentPreviewModel': model };
  const exports = {};
  new Function('exports', 'require', code)(exports, (name) => {
    if (/\/ui\/(?:button|input|native-select|textarea|checkbox|radio-group|slider)$/.test(name)) return { Button: "Button", Input: "Input", NativeSelect: "NativeSelect", Textarea: "Textarea", Checkbox: "Checkbox", RadioGroup: "RadioGroup", RadioGroupItem: "RadioGroupItem", Slider: "Slider" };

    if (name in dependencies) return dependencies[name];
    if (name.endsWith('.css')) return {};
    assert.ok(name === 'lucide-react' || name.startsWith('../../components/ui/'), `No external write dependency: ${name}`);
    return components;
  });
  const view = {
    props, submissions, dirtyChanges, focused, scrolled, cancelled: () => cancelled,
    render() {
      const previousOpen = elements(tree).find((node) => node.type === 'AlertDialog')?.props.open;
      cursor = 0; effects = []; tree = exports.ShipmentActionForm(props);
      const dom = (node) => node ? { focus() { focused.push(node.props.id ?? node.type); }, scrollIntoView(options) { scrolled.push({ id: node.props.id, options }); }, querySelector(selector) { return dom(elements(tree).find((item) => `#${item.props?.id}` === selector)); } } : null;
      for (const node of elements(tree)) if (node.props?.ref) node.props.ref.current = dom(node);
      effects.forEach((job) => job()); effects = [];
      if (previousOpen && !view.node('AlertDialog').props.open) view.node('AlertDialogContent').props.onCloseAutoFocus({ preventDefault() {} });
      return tree;
    },
    async settle() { await new Promise((resolve) => setImmediate(resolve)); return view.render(); },
    unmount() { slots.forEach((slot) => slot?.cleanup?.()); },
    text: () => text(tree), nodes: () => elements(tree), node: (type) => elements(tree).find((node) => node.type === type),
    field: (name) => elements(tree).find((node) => node.props?.id === `shipment-action-${name}`),
    checkbox: () => elements(tree).find((node) => node.type === "Checkbox"),
    button: (label) => elements(tree).find((node) => ['Button', 'AlertDialogAction', 'AlertDialogCancel'].includes(node.type) && text(node).trim() === label),
    fill(name, value) { const node = view.field(name); assert.ok(node, `${name} exists`); assert.equal(Boolean(node.props.disabled), false); node.props.onChange({ target: { value } }); return view.render(); },
    choose(name, value) { const node = view.nodes().find((item) => item.type === 'Select' && elements(item).some((child) => child.props?.id === `shipment-action-${name}`)); assert.ok(node, `${name} selectable`); assert.equal(Boolean(node.props.disabled), false); node.props.onValueChange(value); return view.render(); },
    submit() { view.node('form').props.onSubmit({ preventDefault() {} }); return view.render(); },
    confirm() { const action = view.node('AlertDialogAction'); assert.ok(action); assert.equal(Boolean(action.props.disabled), false); action.props.onClick({ preventDefault() {} }); return view.render(); },
    cancelConfirmation() { view.node('AlertDialog').props.onOpenChange(false); return view.render(); },
    setProps(patch) { Object.assign(props, patch); return view.render(); },
  };
  view.render(); return view;
}

function fillValid(view) {
  const { kind } = view.props.context;
  if (kind === 'create') {
    view.fill('documentNo', ' SHIP-0910-NEW '); view.fill('actualDate', '2026-09-10');
    view.fill('customer', ' 华南客户 '); view.fill('orderNo', ' SO-0902 ');
    view.choose('batchId', 'batch-02'); view.fill('quantity', '20'); view.fill('handler', ' 仓管员 A ');
  }
  if (kind !== 'create') view.fill('actor', ' 仓管员 B ');
  if (['edit', 'reverse', 'sn'].includes(kind)) view.fill('reason', ' 核对原出库单后更正登记。 ');
  if (kind === 'sn') view.fill('serialNumbers', ' SN-A001 \n\n SN-A002 ');
}

test('五种操作均先确认再提交真实模型，字段正确且保留原始记录', async () => {
  const keys = {
    create: ['kind', 'documentNo', 'actualDate', 'customer', 'orderNo', 'batchId', 'quantity', 'handler', 'note', 'serialNumbers', 'actor'],
    edit: ['kind', 'documentNo', 'actualDate', 'customer', 'orderNo', 'batchId', 'quantity', 'handler', 'note', 'serialNumbers', 'actor', 'recordId', 'reason'],
    confirm: ['kind', 'recordId', 'actor'], reverse: ['kind', 'recordId', 'actor', 'reason', 'createReplacement'], sn: ['kind', 'recordId', 'actor', 'reason', 'serialNumbers'],
  };
  for (const kind of Object.keys(keys)) {
    const context = contextFor(kind); let result;
    const view = fixture({ context, submit: (action) => { result = model.applyShipmentAction(context.state, context.state.version, action, '2026-09-11T08:00:00.000Z'); } });
    fillValid(view); view.submit(); assert.equal(view.node('AlertDialog').props.open, true, kind); assert.equal(view.submissions.length, 0);
    view.confirm(); await view.settle(); assert.equal(result.version, 2, kind); assert.equal(view.submissions.length, 1);
    assert.deepEqual(Object.keys(view.submissions[0]).sort(), keys[kind].sort());
    assert.equal(view.dirtyChanges.at(-1), false); assert.match(view.text(), /已保存|已确认实际出库|已冲销记录/);
    assert.equal(view.nodes().find((node) => node.type === 'Button' && node.props.type === 'submit').props.disabled, true, 'successful standalone form cannot resubmit');
    assert.equal(model.shipmentMonthSummary(context.state, '2026-09').shipped, 180, 'input state immutable');
  }
});

test('新增表单无默认经办人，必填错误关联字段并聚焦第一项', () => {
  const view = fixture(); assert.equal(view.field('handler').props.value, ''); view.submit();
  assert.equal(view.focused.at(-1), 'shipment-action-documentNo'); assert.equal(view.field('documentNo').props['aria-invalid'], true);
  assert.equal(view.field('documentNo').props['aria-describedby'], 'shipment-action-documentNo-error');
  const before = view.focused.length; view.fill('documentNo', 'NEW'); assert.equal(view.focused.length, before);
  view.submit(); assert.equal(view.focused.at(-1), 'shipment-action-actualDate');
});

test('拒绝零数、小数、负数、指数、非数和超安全整数数量', () => {
  const view = fixture(); fillValid(view);
  for (const quantity of ['', '0', '0.5', '1.0', '-2', '1e2', 'NaN', 'Infinity', '9007199254740992']) {
    view.fill('quantity', quantity); view.submit(); assert.equal(view.node('AlertDialog').props.open, false, quantity); assert.equal(view.field('quantity').props['aria-invalid'], true, quantity);
  }
  view.fill('quantity', '1'); view.submit(); assert.equal(view.node('AlertDialog').props.open, true);
});

test('日期须真实有效，不接受未来日期，未选批次不能登记', () => {
  const view = fixture(); fillValid(view);
  for (const value of ['2026-02-30', '2026-13-01', 'not-a-date']) {
    view.fill('actualDate', value); view.submit(); assert.equal(view.field('actualDate').props['aria-invalid'], true);
  }
  view.fill('actualDate', '2099-01-01'); view.submit(); assert.match(view.text(), /不能晚于今天/);
  view.fill('actualDate', '2026-09-10'); view.choose('batchId', 'no-batch'); view.submit(); assert.equal(view.field('batchId').props['aria-invalid'], true);
});

test('单号重复由真实模型阻止，非破坏性错误保留表单', () => {
  const view = fixture(); fillValid(view); view.fill('documentNo', ' ship-0908-01 '); view.submit();
  assert.equal(view.node('AlertDialog').props.open, false); assert.match(view.text(), /出库单号已存在/); assert.equal(view.field('documentNo').props.value, ' ship-0908-01 ');
});

test('可留空 SN，部分清单标记待补齐，拒绝重复、超额和跨单重用', () => {
  const view = fixture(); fillValid(view); view.submit(); assert.equal(view.node('AlertDialog').props.open, true); assert.match(view.text(), /待补齐\s+20/); view.cancelConfirmation();
  view.fill('serialNumbers', ' SN001 \n\n SN002 '); view.submit(); assert.match(text(view.node('AlertDialogContent')), /2 \/ 18 台/); view.cancelConfirmation();
  view.fill('serialNumbers', 'SN001\nsn001'); view.submit(); assert.equal(view.field('serialNumbers').props['aria-invalid'], true);
  view.fill('serialNumbers', Array.from({ length: 21 }, (_, index) => `SN${index}`).join('\n')); view.submit(); assert.match(view.text(), /不得超过本次出货/);
  view.props.context.state.records[0].serialNumbers = ['USED']; view.fill('serialNumbers', 'used'); view.submit(); assert.match(view.text(), /SN 已关联其他有效登记/);
});

test('编辑预填原登记，修改原因及本次操作人必填', () => {
  const view = fixture({ kind: 'edit' }); assert.equal(view.field('quantity').props.value, '20'); assert.equal(view.field('actor').props.value, '');
  view.submit(); assert.equal(view.field('actor').props['aria-invalid'], true); assert.equal(view.field('reason').props['aria-invalid'], true);
  fillValid(view); view.fill('reason', '长'.repeat(1001)); view.submit(); assert.equal(view.field('reason').props['aria-invalid'], true);
  assert.equal(view.field('reason').props.maxLength, 1000);
});

test('选填备注与 SN 默认折叠，SN 校验失败自动展开并聚焦，不隐藏错误', () => {
  const view = fixture(); fillValid(view); assert.equal(view.node('details').props.open, false);
  view.fill('serialNumbers', 'SN1\nsn1'); view.submit(); assert.equal(view.node('details').props.open, true);
  assert.equal(view.focused.at(-1), 'shipment-action-serialNumbers'); assert.match(view.text(), /存在重复 SN/);
  const sn = fixture({ kind: 'sn' }); assert.equal(sn.node('details'), undefined); assert.ok(sn.field('serialNumbers'));
});

test('主操作和二次确认使用当前业务动作名称', () => {
  const labels = {
    create: ['保存出货登记', '确认保存出货登记'], edit: ['保存修改', '确认保存修改'],
    confirm: ['确认实际出库', '确认实际出库'], reverse: ['冲销记录', '确认冲销记录'], sn: ['保存 SN', '确认保存 SN'],
  };
  for (const [kind, [save, confirm]] of Object.entries(labels)) {
    const view = fixture({ kind }); fillValid(view); assert.ok(view.button(save), kind); view.submit();
    assert.equal(text(view.node('AlertDialogTitle')), confirm); assert.equal(text(view.node('AlertDialogAction')), confirm);
  }
});

test('确认显示终检与授权放行的区别，确认 20 台后出货 200 完工 216', async () => {
  const context = contextFor('confirm'); let state;
  const view = fixture({ context, submit: (action) => { state = model.applyShipmentAction(context.state, 1, action); } });
  fillValid(view); assert.match(view.text(), /终检合格\s+116/); assert.match(view.text(), /质量放行\s+100/); assert.match(view.text(), /当前可出货\s+20/);
  view.submit(); assert.match(text(view.node('AlertDialogContent')), /20 台计入 2026-09/); view.confirm(); await view.settle();
  const total = model.shipmentMonthSummary(state, '2026-09'); assert.equal(total.shipped, 200); assert.equal(total.completed, 216);
});

test('确认前阻止无放行、超放行余额、早于放行日期的登记', () => {
  for (const [patch, expected] of [[{ batchId: 'batch-03' }, /尚无质量授权放行依据/], [{ quantity: 21 }, /超过本批剩余授权放行数量/], [{ actualDate: '2026-09-06' }, /不能早于质量放行日期/]]) {
    const context = contextFor('confirm'); Object.assign(context.state.records.find((record) => record.id === context.recordId), patch);
    const view = fixture({ context }); fillValid(view); view.submit(); assert.equal(view.node('AlertDialog').props.open, false); assert.match(view.text(), expected);
  }
});

test('冲销默认生成关联草稿，可取消生成，原记录与冲销原因保留', async () => {
  for (const createReplacement of [true, false]) {
    const context = contextFor('reverse'); let state; const view = fixture({ context, submit: (action) => { state = model.applyShipmentAction(context.state, 1, action); } });
    fillValid(view); assert.equal(view.checkbox().props.checked, true); view.checkbox().props.onCheckedChange(createReplacement); view.render(); view.submit();
    assert.match(text(view.node('AlertDialogContent')), /不代表实物退货/); view.confirm(); await view.settle();
    assert.equal(state.records.find((record) => record.id === 'ship-80').status, 'reversed');
    assert.equal(state.records.filter((record) => record.replacementFor === 'ship-80').length, createReplacement ? 1 : 0);
    assert.equal(model.shipmentMonthSummary(state, '2026-09').shipped, 100);
  }
});

test('补充 SN 只提交清单，不暴露数量日期编辑，未改清单不能保存', () => {
  const view = fixture({ kind: 'sn' }); fillValid(view); assert.equal(view.field('quantity'), undefined); assert.equal(view.field('actualDate'), undefined);
  view.fill('serialNumbers', ''); view.submit(); assert.match(view.text(), /SN 列表没有变化/);
});

test('只读真实禁用字段与提交，关闭仍可操作', () => {
  const context = { ...contextFor('create'), readOnly: true }; const view = fixture({ context });
  assert.equal(view.field('documentNo').props.disabled, true); assert.equal(view.nodes().find((node) => node.type === 'Button' && node.props.type === 'submit').props.disabled, true);
  view.node('form').props.onSubmit({ preventDefault() {} }); view.render(); assert.equal(view.submissions.length, 0); assert.equal(view.node('AlertDialog').props.open, false);
  view.button('取消填写').props.onClick(); assert.equal(view.cancelled(), 1);
});

test('确认期间变为只读时拒绝保存且保留输入', () => {
  const view = fixture(); fillValid(view); view.submit(); view.setProps({ context: { ...view.props.context, readOnly: true } });
  view.confirm(); assert.equal(view.submissions.length, 0); assert.equal(view.node('AlertDialog').props.open, false); assert.equal(view.field('quantity').props.value, '20');
});

test('初始版本及确认版本变化均阻止旧操作，重新打开前保留输入', () => {
  for (const duringConfirmation of [true, false]) {
    const view = fixture(); fillValid(view); if (duringConfirmation) view.submit();
    view.setProps({ context: { ...view.props.context, state: { ...view.props.context.state, version: 99 } } });
    if (duringConfirmation) view.confirm(); else view.submit();
    assert.equal(view.submissions.length, 0); assert.match(view.text(), /出货记录已变化/); assert.equal(view.field('quantity').props.value, '20');
  }
});

test('操作单据切换未重挂载时拒绝旧表单', () => {
  const view = fixture({ kind: 'confirm' }); fillValid(view); view.setProps({ context: { ...view.props.context, recordId: 'ship-80' } }); view.submit();
  assert.equal(view.node('AlertDialog').props.open, false); assert.match(view.text(), /当前单据或操作已变化/);
});

test('失败显示就地错误并保留输入，重试成功后清除脏状态', async () => {
  let fail = true; const view = fixture({ submit: () => { if (fail) throw new Error('模拟保存失败，请重试'); } });
  fillValid(view); view.submit(); view.confirm(); await view.settle(); assert.equal(view.field('quantity').props.value, '20'); assert.equal(view.dirtyChanges.at(-1), true); assert.match(view.text(), /模拟保存失败/);
  fail = false; view.submit(); view.confirm(); await view.settle(); assert.equal(view.submissions.length, 2); assert.equal(view.dirtyChanges.at(-1), false);
});

test('忙碌时同步防重复提交、锁定输入和关闭弹窗', async () => {
  const pending = deferred(); const view = fixture({ submit: () => pending.promise }); fillValid(view); view.submit();
  const action = view.node('AlertDialogAction'); action.props.onClick({ preventDefault() {} }); action.props.onClick({ preventDefault() {} }); view.render();
  assert.equal(view.submissions.length, 1); assert.equal(view.field('quantity').props.disabled, true); assert.equal(view.node('form').props['aria-busy'], true);
  view.node('AlertDialog').props.onOpenChange(false); view.render(); assert.equal(view.node('AlertDialog').props.open, true); assert.equal(view.button('取消填写').props.disabled, true);
  pending.resolve(); await view.settle(); assert.equal(view.node('form').props['aria-busy'], false);
});

test('卸载后异步完成不会回写脏状态', async () => {
  const pending = deferred(); const view = fixture({ submit: () => pending.promise }); fillValid(view); view.submit(); view.confirm();
  const count = view.dirtyChanges.length; view.unmount(); pending.resolve(); await new Promise((resolve) => setImmediate(resolve)); assert.equal(view.dirtyChanges.length, count);
});

test('取消确认保留输入并恢复保存按钮焦点；取消填写交由父页面处理', () => {
  const view = fixture(); fillValid(view); view.submit(); view.cancelConfirmation(); assert.equal(view.field('quantity').props.value, '20'); assert.equal(view.focused.at(-1), 'Button');
  view.button('取消填写').props.onClick(); assert.equal(view.cancelled(), 1);
});
