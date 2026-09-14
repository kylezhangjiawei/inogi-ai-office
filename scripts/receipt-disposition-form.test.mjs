import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

const source = readFileSync(new URL('../src/app/procurement/components/ReceiptDispositionForm.tsx', import.meta.url), 'utf8');
const code = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
const jsx = (type, props) => typeof type === 'function' ? type(props) : { type, props };
const components = new Proxy({}, { get: (_target, key) => key });
const labels = { correction: '收货纠错', inbound: '合格入库', isolation: '不良隔离', return: '退换补货' };
const t = (value, params = {}) => value.replace(/\{(\w+)\}/g, (match, name) => params[name] ?? match);
function elements(tree) {
  if (Array.isArray(tree)) return tree.flatMap(elements);
  if (!tree || typeof tree !== 'object') return [];
  return [...(tree.type ? [tree] : []), ...Object.values(tree.props ?? {}).flatMap(elements)];
}
function text(tree) {
  if (Array.isArray(tree)) return tree.map(text).join(' ');
  if (typeof tree === 'string' || typeof tree === 'number') return String(tree);
  return tree && typeof tree === 'object' ? text(tree.props?.children) : '';
}
function deferred() { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; }
const receipt = { id: 'r1', version: 1, orderNo: 'PO-1', lineNo: '1', deliveryNo: 'DN-1', materialCode: 'VALVE-1', materialName: '阀体', spec: 'A型', unit: '件', supplierName: '供应商 A', orderedQty: 100, originalReceivedQty: 60, receivedQty: 60, receivedDate: '2020-01-01', qualifiedQty: 45, defectiveQty: 8, pendingJudgmentQty: 2, inboundQty: 10, isolatedQty: 2, returnPlannedQty: 0 };
const limits = { correctionMin: 55, correctionMax: 100, inbound: 35, isolation: 6, return: 2 };

function fixture({ kind = 'inbound', submit, props: overrides = {} } = {}) {
  const slots = [], submissions = [], dirtyChanges = [], focused = [], scrolled = [];
  let cursor = 0, effects = [], tree, cancelled = 0;
  const same = (a, b) => Boolean(a && b && a.length === b.length && a.every((value, index) => Object.is(value, b[index])));
  const react = {
    useState(initial) { const index = cursor++; if (!(index in slots)) slots[index] = typeof initial === 'function' ? initial() : initial; return [slots[index], (value) => { slots[index] = typeof value === 'function' ? value(slots[index]) : value; }]; },
    useRef(initial) { const index = cursor++; return slots[index] ??= { current: initial }; },
    useEffect(callback, deps) { const index = cursor++; const previous = slots[index]; if (!same(previous?.deps, deps)) effects.push(() => { previous?.cleanup?.(); slots[index] = { deps, cleanup: callback() }; }); },
  };
  const props = { receipt, kind, limits, onSubmit: async (input) => { submissions.push(input); await submit?.(input); }, onDirtyChange: (dirty) => dirtyChanges.push(dirty), onCancel: () => { cancelled += 1; }, ...overrides };
  const dependencies = { react, 'react/jsx-runtime': { jsx, jsxs: jsx, Fragment: 'Fragment' }, '../../lib/i18n': { useI18n: () => ({ t }), i18nLocale: () => 'zh-CN' }, '../../components/ui/utils': { cn: (...parts) => parts.filter(Boolean).join(' ') }, '../receiptDispositionTypes': { dispositionLabels: labels } };
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
      cursor = 0; effects = []; tree = exports.ReceiptDispositionForm(props);
      const dom = (node) => node ? { focus() { focused.push(node.props.id ?? node.type); }, scrollIntoView(options) { scrolled.push({ id: node.props.id, options }); }, querySelector(selector) { return dom(elements(tree).find((element) => `#${element.props?.id}` === selector)); } } : null;
      for (const node of elements(tree)) if (node.props?.ref) node.props.ref.current = dom(node);
      const jobs = effects; effects = []; jobs.forEach((job) => job());
      if (previousOpen && !view.node('AlertDialog').props.open) view.node('AlertDialogContent').props.onCloseAutoFocus({ preventDefault() {} });
      return tree;
    },
    async settle() { await new Promise((resolve) => setImmediate(resolve)); return view.render(); },
    tree: () => tree, text: () => text(tree), nodes: () => elements(tree),
    node(type) { return elements(tree).find((node) => node.type === type); },
    field(name) { return elements(tree).find((node) => node.props?.id === `receipt-disposition-${name}`); },
    button(label) { return elements(tree).find((node) => ['Button', 'AlertDialogAction', 'AlertDialogCancel'].includes(node.type) && text(node).trim() === label); },
    fill(name, value) { const node = view.field(name); assert.ok(node, `${name} exists`); assert.equal(Boolean(node.props.disabled), false, `${name} editable`); node.props.onChange({ target: { value } }); return view.render(); },
    choose(name, value) { const node = name === 'returnMethod' ? view.field(name) : view.nodes().find((item) => item.type === 'Select' && elements(item).some((child) => child.props?.id === `receipt-disposition-${name}`)); assert.ok(node, `${name} selectable`); assert.equal(Boolean(node.props.disabled), false); node.props.onValueChange(value); return view.render(); },
    submit() { view.node('form').props.onSubmit({ preventDefault() {} }); return view.render(); },
    confirm() { const action = view.button('确认保存演示记录'); assert.ok(action); assert.equal(Boolean(action.props.disabled), false); action.props.onClick({ preventDefault() {} }); return view.render(); },
    cancelConfirmation() { view.node('AlertDialog').props.onOpenChange(false); return view.render(); },
    setProps(patch) { Object.assign(props, patch); return view.render(); },
  };
  view.render(); return view;
}

function fillValid(view, { quantity = '1.125', method = 'return' } = {}) {
  view.fill('quantity', quantity); view.fill('date', '2020-02-02'); view.fill('reason', ' 按检验结果与送货单核对后安排。 ');
  if (view.props.kind === 'inbound' || view.props.kind === 'isolation') {
    view.choose('warehouse', view.props.kind === 'inbound' ? '原材料仓' : '不合格品区');
    view.choose('location', view.props.kind === 'inbound' ? 'A-01-01' : 'NG-01');
  }
  if (view.props.kind === 'inbound' || view.props.kind === 'return') view.fill('documentNo', ' DOC-001 ');
  if (view.props.kind === 'isolation' || view.props.kind === 'return') view.fill('owner', ' 王晴 ');
  if (view.props.kind === 'return') { view.choose('returnMethod', method); if (method === 'replacement') view.fill('expectedDate', '2020-02-03'); }
}

test('四种动作仅调用父级保存，提交后必须先经过 AlertDialog 核对', async () => {
  for (const kind of Object.keys(labels)) {
    const view = fixture({ kind }); fillValid(view, { quantity: kind === 'correction' ? '59.125' : '1.125' });
    view.submit(); assert.equal(view.submissions.length, 0); assert.equal(view.node('AlertDialog').props.open, true);
    assert.match(text(view.node('AlertDialogContent')), /DN-1/);
    view.confirm(); await view.settle(); assert.equal(view.submissions.length, 1); assert.equal(view.submissions[0].kind, kind);
    assert.equal(view.submissions[0].quantity, kind === 'correction' ? 59.125 : 1.125);
    assert.equal(view.submissions[0].reason, '按检验结果与送货单核对后安排。');
    assert.match(view.text(), /演示记录已保存/); assert.equal(view.node('AlertDialog').props.open, false);
  }
});

test('入库依据待入库合格量校验，保留库位与单据但清空无关字段', async () => {
  const view = fixture(); fillValid(view); view.fill('note', ' 独立摆放 '); view.submit(); view.confirm(); await view.settle();
  assert.deepEqual(view.submissions[0], { kind: 'inbound', quantity: 1.125, date: '2020-02-02', reason: '按检验结果与送货单核对后安排。', warehouse: '原材料仓', location: 'A-01-01', documentNo: 'DOC-001', owner: '', returnMethod: 'return', expectedDate: '', note: '独立摆放' });
});

test('数量拒绝零值、负值、指数、超精度、非数值与超大数值', () => {
  for (const value of ['0', '-1', '1e1', '0.0001', '', 'NaN', 'Infinity', '9999999999999999999999999999999999999']) {
    const view = fixture(); fillValid(view); view.fill('quantity', value); view.submit();
    assert.equal(view.node('AlertDialog').props.open, false, value); assert.equal(view.field('quantity').props['aria-invalid'], true, value);
    assert.match(view.field('quantity').props['aria-describedby'], /quantity-error/); assert.equal(view.submissions.length, 0);
  }
});

test('不同处置分别使用自己的数量上限，超量错误贴近输入，临界值允许', () => {
  for (const kind of ['inbound', 'isolation', 'return']) {
    const view = fixture({ kind }); fillValid(view); view.fill('quantity', String(limits[kind] + 0.001)); view.submit();
    assert.equal(view.node('AlertDialog').props.open, false); assert.equal(view.field('quantity').props['aria-invalid'], true); assert.match(view.text(), /数量须在/);
    view.fill('quantity', String(limits[kind])); view.submit(); assert.equal(view.node('AlertDialog').props.open, true);
  }
});

test('纠错使用改后的总实收，不能低于已分类合计、超过订单量或提交原值', async () => {
  const view = fixture({ kind: 'correction' }); assert.equal(view.field('quantity').props.value, '60'); fillValid(view, { quantity: '59.125' });
  for (const value of ['54.999', '100.001', '60']) { view.fill('quantity', value); view.submit(); assert.equal(view.node('AlertDialog').props.open, false); }
  view.fill('quantity', '55'); view.submit(); assert.match(view.text(), /-5/); view.confirm(); await view.settle();
  assert.equal(view.submissions[0].quantity, 55); assert.equal(view.field('quantity').props.value, '55'); assert.equal(view.dirtyChanges.at(-1), false);
});

test('未分类批次的纠正数量也必须为正，不能把实收纠正为零', () => {
  const view = fixture({ kind: 'correction', props: { limits: { ...limits, correctionMin: 0 } } }); fillValid(view, { quantity: '0' }); view.submit();
  assert.equal(view.node('AlertDialog').props.open, false); assert.equal(view.field('quantity').props['aria-invalid'], true); assert.match(view.text(), /请填写大于 0 的数量/); assert.equal(view.submissions.length, 0);
});

test('隔离只呈现已判不良的可隔离量，明确待判定不在范围内', async () => {
  const view = fixture({ kind: 'isolation' }); assert.match(view.text(), /不良待隔离\s+6\s+件/); assert.match(view.text(), /待判定数量不计入本次可隔离量/);
  fillValid(view); view.submit(); view.confirm(); await view.settle(); assert.equal(view.submissions[0].warehouse, '不合格品区'); assert.equal(view.submissions[0].location, 'NG-01'); assert.equal(view.submissions[0].owner, '王晴'); assert.equal(view.submissions[0].documentNo, '');
});

test('各模式必填原因与处置日期，拒绝不存在、过早或未来的日期', () => {
  for (const kind of Object.keys(labels)) {
    const view = fixture({ kind }); fillValid(view, { quantity: kind === 'correction' ? '59' : '1' }); view.fill('reason', '  '); view.submit(); assert.equal(view.field('reason').props['aria-invalid'], true); assert.equal(view.node('AlertDialog').props.open, false);
    view.fill('reason', '核对记录');
    for (const date of ['', '2020-02-30', '2019-12-31', '9999-01-01']) { view.fill('date', date); view.submit(); assert.equal(view.field('date').props['aria-invalid'], true); assert.equal(view.node('AlertDialog').props.open, false); }
  }
});

test('仓库、库位、单据与负责人按动作必填，切换仓库清除旧库位', () => {
  const inbound = fixture(); fillValid(inbound); inbound.choose('warehouse', '备件仓'); assert.equal(inbound.nodes().find((item) => item.type === 'Select' && elements(item).some((child) => child.props?.id === 'receipt-disposition-location')).props.value, '');
  inbound.submit(); assert.equal(inbound.field('location').props['aria-invalid'], true); inbound.choose('location', 'B-01-01'); inbound.fill('documentNo', ''); inbound.submit(); assert.equal(inbound.field('documentNo').props['aria-invalid'], true);
  for (const kind of ['isolation', 'return']) { const view = fixture({ kind }); fillValid(view); view.fill('owner', ''); view.submit(); assert.equal(view.field('owner').props['aria-invalid'], true); }
});

test('换补安排必须有预计日期，日期不能早于安排日且确认弹框能核对', async () => {
  const view = fixture({ kind: 'return' }); fillValid(view, { method: 'replacement' }); view.fill('expectedDate', ''); view.submit(); assert.equal(view.field('expectedDate').props['aria-invalid'], true);
  view.fill('expectedDate', '2020-02-01'); view.submit(); assert.equal(view.node('AlertDialog').props.open, false);
  view.fill('expectedDate', '2020-02-03'); view.submit(); assert.match(text(view.node('AlertDialogContent')), /预计补货日期\s+2020-02-03/); assert.match(text(view.node('AlertDialogContent')), /DOC-001/);
  view.confirm(); await view.settle(); assert.equal(view.submissions[0].expectedDate, '2020-02-03'); assert.equal(view.submissions[0].returnMethod, 'replacement');
});

test('从换补切回退货清除预计日期，供应商仅只读，文案保持安排状态', async () => {
  const view = fixture({ kind: 'return' }); fillValid(view, { method: 'replacement' }); view.choose('returnMethod', 'return'); assert.equal(view.field('expectedDate'), undefined);
  assert.equal(view.field('supplier').props.readOnly, true); assert.equal(view.field('supplier').props.value, receipt.supplierName);
  assert.match(view.text(), /安排记录不会标记为已退回或补货已到货/); view.submit(); view.confirm(); await view.settle(); assert.equal(view.submissions[0].expectedDate, '');
});

test('取消确认保留草稿且不保存，表单取消交给父级草稿保护', () => {
  const view = fixture(); assert.equal(view.dirtyChanges.at(-1), false); fillValid(view); assert.equal(view.dirtyChanges.at(-1), true); view.submit(); view.cancelConfirmation();
  assert.equal(view.node('AlertDialog').props.open, false); assert.equal(view.field('quantity').props.value, '1.125'); assert.equal(view.submissions.length, 0);
  view.button('取消填写').props.onClick(); assert.equal(view.cancelled(), 1); assert.equal(view.dirtyChanges.at(-1), true);
});

test('确认保存时防止双击，期间不能取消、逃逸或修改字段', async () => {
  const pending = deferred(); const view = fixture({ submit: () => pending.promise }); fillValid(view); view.submit();
  const action = view.button('确认保存演示记录').props.onClick; action({ preventDefault() {} }); action({ preventDefault() {} }); view.render();
  assert.equal(view.submissions.length, 1); assert.equal(view.node('form').props['aria-busy'], true); assert.equal(view.field('quantity').props.disabled, true); assert.equal(view.button('取消填写').props.disabled, true);
  view.node('AlertDialog').props.onOpenChange(false); view.render(); assert.equal(view.node('AlertDialog').props.open, true);
  let prevented = false; view.node('AlertDialogContent').props.onEscapeKeyDown({ preventDefault() { prevented = true; } }); assert.equal(prevented, true);
  pending.resolve(); await view.settle(); assert.equal(view.node('form').props['aria-busy'], false); assert.equal(view.dirtyChanges.at(-1), false);
});

test('父级保存失败保持填写并就近显示错误，可核对重试', async () => {
  let fail = true; const view = fixture({ submit: () => { if (fail) throw new Error('演示记录保存失败，请重试。'); } }); fillValid(view); view.submit(); view.confirm(); await view.settle();
  assert.equal(view.node('AlertDialog').props.open, false); assert.equal(view.field('quantity').props.value, '1.125'); assert.equal(view.field('reason').props.value, ' 按检验结果与送货单核对后安排。 '); assert.match(view.text(), /演示记录保存失败，请重试/); assert.equal(view.dirtyChanges.at(-1), true);
  fail = false; view.submit(); view.confirm(); await view.settle(); assert.equal(view.submissions.length, 2); assert.equal(view.dirtyChanges.at(-1), false); assert.equal(view.field('quantity').props.value, '');
});

test('确认期间可用量改变会重新校验，不提交旧上限下的表单', () => {
  const view = fixture(); fillValid(view, { quantity: '30' }); view.submit(); view.setProps({ limits: { ...limits, inbound: 20 } }); view.confirm();
  assert.equal(view.submissions.length, 0); assert.equal(view.node('AlertDialog').props.open, false); assert.equal(view.field('quantity').props['aria-invalid'], true);
});

test('零可用量提示从上方换选处置并禁止保存，仍可取消', () => {
  const view = fixture({ kind: 'isolation', props: { limits: { ...limits, isolation: 0 } } }); assert.equal(view.button('保存演示记录').props.disabled, true); assert.match(view.text(), /请使用上方处置选项/); assert.equal(view.button('选择其他处置'), undefined);
  view.button('取消填写').props.onClick(); assert.equal(view.cancelled(), 1);
});

test('字段文本长度在提交时再次校验，不能通过粘贴或脚本绕开限制', () => {
  const view = fixture({ kind: 'return' }); fillValid(view);
  for (const [field, length] of [['reason', 1001], ['note', 1001], ['documentNo', 121], ['owner', 81]]) {
    const previous = view.field(field).props.value; view.fill(field, '长'.repeat(length)); view.submit(); assert.equal(view.field(field).props['aria-invalid'], true); assert.equal(view.node('AlertDialog').props.open, false); view.fill(field, previous);
  }
});

test('点击保存只聚焦首个无效字段，修改输入时不再跳焦点', () => {
  const view = fixture(); view.submit(); assert.equal(view.focused.at(-1), 'receipt-disposition-quantity'); assert.equal(view.scrolled.at(-1).id, 'receipt-disposition-quantity');
  const focusCount = view.focused.length; view.fill('quantity', '1'); view.fill('date', '2020-02-02'); assert.equal(view.focused.length, focusCount);
  view.submit(); assert.equal(view.focused.at(-1), 'receipt-disposition-warehouse');
  view.choose('warehouse', '原材料仓'); view.choose('location', 'A-01-01'); view.fill('documentNo', 'DOC-1'); view.submit(); assert.equal(view.focused.at(-1), 'receipt-disposition-reason');
});

test('确认时重校验失败在弹框关闭后聚焦无效字段，取消正常确认返回保存按钮', () => {
  const view = fixture(); fillValid(view, { quantity: '30' }); view.submit(); view.setProps({ limits: { ...limits, inbound: 20 } }); view.confirm();
  assert.equal(view.focused.at(-1), 'receipt-disposition-quantity'); assert.equal(view.scrolled.at(-1).id, 'receipt-disposition-quantity');
  view.fill('quantity', '10'); view.submit(); view.cancelConfirmation(); assert.equal(view.focused.at(-1), 'Button');
});
