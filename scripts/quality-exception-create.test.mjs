import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

const source = readFileSync(new URL('../src/app/procurement/quality/QualityExceptionCreateDialog.tsx', import.meta.url), 'utf8');
const code = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
const jsx = (type, props) => typeof type === 'function' ? type(props) : { type, props };
const components = new Proxy({}, { get: (_target, key) => key });
const labels = { incoming: '来料', warehouse: '仓库', production: '生产反馈', after_sales: '售后' };
const t = (value, params = {}) => value.replace(/\{(\w+)\}/g, (match, name) => params[name] ?? match);
function elements(tree) { if (Array.isArray(tree)) return tree.flatMap(elements); if (!tree || typeof tree !== 'object') return []; return [...(tree.type ? [tree] : []), ...Object.values(tree.props ?? {}).flatMap(elements)]; }
function text(tree) { if (Array.isArray(tree)) return tree.map(text).join(' '); if (typeof tree === 'string' || typeof tree === 'number') return String(tree); return tree && typeof tree === 'object' ? text(tree.props?.children) : ''; }
function deferred() { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; }
function fixture({ submit, open = true } = {}) {
  const slots = [], submissions = [], closes = [], focused = [], scrolled = [], dirtyChanges = [];
  let cursor = 0, effects = [], tree;
  const same = (a, b) => Boolean(a && b && a.length === b.length && a.every((value, index) => Object.is(value, b[index])));
  const react = {
    useState(initial) { const index = cursor++; if (!(index in slots)) slots[index] = typeof initial === 'function' ? initial() : initial; return [slots[index], (value) => { slots[index] = typeof value === 'function' ? value(slots[index]) : value; }]; },
    useRef(initial) { const index = cursor++; return slots[index] ??= { current: initial }; },
    useEffect(callback, deps) { const index = cursor++; const previous = slots[index]; if (!same(previous?.deps, deps)) effects.push(() => { previous?.cleanup?.(); slots[index] = { deps, cleanup: callback() }; }); },
  };
  const props = { open, onOpenChange(value) { closes.push(value); props.open = value; }, onDirtyChange(value) { dirtyChanges.push(value); }, async onSubmit(input) { submissions.push(input); await submit?.(input); } };
  const dependencies = { react, 'react/jsx-runtime': { jsx, jsxs: jsx, Fragment: 'Fragment' }, '../../lib/i18n': { useI18n: () => ({ t }), i18nLocale: () => 'zh-CN' }, '../../components/ui/utils': { cn: (...parts) => parts.filter(Boolean).join(' ') }, './qualityExceptionTypes': { qualitySourceLabels: labels } };
  const exports = {};
  new Function('exports', 'require', code)(exports, (name) => {
    if (name in dependencies) return dependencies[name];
    assert.ok(name.startsWith('../../components/ui/'), `No external write dependency: ${name}`); return components;
  });
  const view = {
    props, submissions, closes, focused, scrolled, dirtyChanges,
    render() {
      const previousOpen = elements(tree).find((node) => node.type === 'AlertDialog')?.props.open;
      cursor = 0; effects = []; tree = exports.QualityExceptionCreateDialog(props);
      const dom = (node) => node ? { focus() { focused.push(node.props.id ?? node.type); }, scrollIntoView(options) { scrolled.push({ id: node.props.id, options }); }, querySelector(selector) { return dom(elements(tree).find((element) => `#${element.props?.id}` === selector)); } } : null;
      for (const node of elements(tree)) if (node.props?.ref) node.props.ref.current = dom(node);
      const jobs = effects; effects = []; jobs.forEach((job) => job());
      if (previousOpen && !view.node('AlertDialog').props.open) view.node('AlertDialogContent').props.onCloseAutoFocus({ preventDefault() {} });
      return tree;
    },
    async settle() { await new Promise((resolve) => setImmediate(resolve)); return view.render(); },
    text: () => text(tree), nodes: () => elements(tree), node(type) { return elements(tree).find((node) => node.type === type); },
    field(name) { return elements(tree).find((node) => node.props?.id === `quality-create-${name}`); },
    button(label) { return elements(tree).find((node) => ['Button', 'AlertDialogAction', 'AlertDialogCancel'].includes(node.type) && text(node).trim() === label); },
    fill(name, value) { const node = view.field(name); assert.ok(node, `${name} exists`); assert.equal(Boolean(node.props.disabled), false); node.props.onChange({ target: { value } }); return view.render(); },
    choose(value) { view.node('Select').props.onValueChange(value); return view.render(); },
    submit() { view.node('form').props.onSubmit({ preventDefault() {} }); return view.render(); },
    confirm() { view.button('确认保存演示异常').props.onClick({ preventDefault() {} }); return view.render(); },
    cancelConfirmation() { view.node('AlertDialog').props.onOpenChange(false); return view.render(); },
    close() { view.node('Dialog').props.onOpenChange(false); return view.render(); },
    reopen() { props.open = true; return view.render(); },
  };
  view.render(); return view;
}
function fillValid(view) {
  for (const [field, value] of Object.entries({ discoveredDate: '2020-02-02', materialCode: ' MAT-001 ', materialName: ' 阀体 ', category: ' 阀组 ', unit: ' 件 ', supplierName: ' 演示供应商 ', batchNo: ' B-001 ', inspectedQty: '12.125', defectiveQty: '1.125', phenomenon: ' 外径测量超出图纸上限。 ', evidence: ' 量测记录 QC-001。 ' })) view.fill(field, value);
}

test('默认来料和北京时间今天，其他三种来源可选，演示说明不伪造附件上传', () => {
  const view = fixture(); assert.equal(view.node('Select').props.value, 'incoming');
  const today = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  assert.equal(view.field('discoveredDate').props.value, today); assert.equal(view.field('discoveredDate').props.max, today);
  for (const value of ['warehouse', 'production', 'after_sales']) { view.choose(value); assert.equal(view.node('Select').props.value, value); }
  assert.match(view.text(), /不会生成正式异常或调整库存/); assert.equal(view.nodes().some((node) => node.props.type === 'file'), false);
});

test('保存前必须核对，确认后只调用父级，修剪字段并关闭重置', async () => {
  const view = fixture(); fillValid(view); view.submit(); assert.equal(view.submissions.length, 0); assert.equal(view.node('AlertDialog').props.open, true);
  assert.match(text(view.node('AlertDialogContent')), /MAT-001/); assert.match(text(view.node('AlertDialogContent')), /12.125 \/ 1.125/);
  view.confirm(); await view.settle(); assert.equal(view.submissions.length, 1);
  assert.deepEqual(view.submissions[0], { source: 'incoming', discoveredDate: '2020-02-02', materialCode: 'MAT-001', materialName: '阀体', category: '阀组', spec: '', unit: '件', supplierName: '演示供应商', batchNo: 'B-001', orderNo: '', inspectedQty: 12.125, defectiveQty: 1.125, phenomenon: '外径测量超出图纸上限。', evidence: '量测记录 QC-001。' });
  assert.deepEqual(view.closes, [false]); view.reopen(); assert.equal(view.field('materialCode').props.value, ''); assert.equal(view.node('Select').props.value, 'incoming');
});

test('规格和订单选填，其余文本必填且错误贴近输入', () => {
  for (const field of ['materialCode', 'materialName', 'category', 'unit', 'supplierName', 'batchNo', 'phenomenon', 'evidence']) {
    const view = fixture(); fillValid(view); view.fill(field, ' '); view.submit(); assert.equal(view.node('AlertDialog').props.open, false, field); assert.equal(view.field(field).props['aria-invalid'], true); assert.match(view.field(field).props['aria-describedby'], /-error$/);
  }
});

test('保存拒绝零值、负数、指数、无效数值、超精度和超限值', () => {
  for (const field of ['inspectedQty', 'defectiveQty']) for (const value of ['0', '-1', '1e1', '0.0001', '', 'NaN', 'Infinity', String(Number.MAX_SAFE_INTEGER)]) {
    const view = fixture(); fillValid(view); view.fill(field, value); view.submit(); assert.equal(view.node('AlertDialog').props.open, false, `${field}: ${value}`); assert.equal(view.field(field).props['aria-invalid'], true);
  }
});

test('不良不能超过检验量，相等与 0.001 临界值可保存', () => {
  const view = fixture(); fillValid(view); view.fill('defectiveQty', '12.126'); view.submit(); assert.match(view.text(), /不良数量不能超过检验数量/);
  view.fill('defectiveQty', '12.125'); view.submit(); assert.equal(view.node('AlertDialog').props.open, true); view.cancelConfirmation(); view.fill('inspectedQty', '0.001'); view.fill('defectiveQty', '0.001'); view.submit(); assert.equal(view.node('AlertDialog').props.open, true);
});

test('日期拒绝无效日、未来、空值、零年，来源必须来自限定选项', () => {
  for (const date of ['', '2020-02-30', '9999-12-31', '0000-01-01']) { const view = fixture(); fillValid(view); view.fill('discoveredDate', date); view.submit(); assert.equal(view.field('discoveredDate').props['aria-invalid'], true); assert.equal(view.node('AlertDialog').props.open, false); }
  const view = fixture(); fillValid(view); view.choose('invalid'); view.submit(); assert.equal(view.field('source').props['aria-invalid'], true); assert.equal(view.node('AlertDialog').props.open, false);
});

test('文本长度提交时重校验，超过数量单位 20、普通文本 120、现象证据 2000 会拦截', () => {
  for (const [field, length] of [['materialCode', 121], ['materialName', 121], ['category', 121], ['spec', 121], ['supplierName', 121], ['batchNo', 121], ['orderNo', 121], ['unit', 21], ['phenomenon', 2001], ['evidence', 2001]]) {
    const view = fixture(); fillValid(view); view.fill(field, '长'.repeat(length)); view.submit(); assert.equal(view.field(field).props['aria-invalid'], true, field); assert.equal(view.node('AlertDialog').props.open, false);
  }
});

test('首次无效聚焦按字段顺序，修改输入不抢焦点', () => {
  const view = fixture(); view.submit(); assert.equal(view.focused.at(-1), 'quality-create-materialCode'); assert.equal(view.scrolled.at(-1).id, 'quality-create-materialCode');
  const count = view.focused.length; view.fill('materialCode', 'MAT-1'); view.fill('materialName', '阀体'); assert.equal(view.focused.length, count); view.submit(); assert.equal(view.focused.at(-1), 'quality-create-category');
});

test('取消保存确认保持草稿，关闭脏表单必须确认放弃', () => {
  const view = fixture(); fillValid(view); view.submit(); view.cancelConfirmation(); assert.equal(view.field('materialCode').props.value, ' MAT-001 '); assert.deepEqual(view.submissions, []);
  view.close(); assert.match(text(view.node('AlertDialogTitle')), /放弃尚未保存/); assert.deepEqual(view.closes, []);
  view.cancelConfirmation(); assert.equal(view.field('batchNo').props.value, ' B-001 '); view.close(); view.button('放弃登记').props.onClick({ preventDefault() {} }); view.render(); assert.deepEqual(view.closes, [false]); view.reopen(); assert.equal(view.field('batchNo').props.value, '');
});

test('干净表单直接关闭，Escape/外点脏表单进入相同放弃确认', () => {
  const clean = fixture(); clean.close(); assert.deepEqual(clean.closes, [false]);
  for (const handler of ['onEscapeKeyDown', 'onPointerDownOutside']) { const view = fixture(); view.fill('phenomenon', '外观破损'); let prevented = false; view.node('DialogContent').props[handler]({ preventDefault() { prevented = true; } }); view.render(); assert.equal(prevented, true); assert.equal(view.node('AlertDialog').props.open, true); assert.deepEqual(view.closes, []); }
});

test('保存期间防双击、关闭、逃逸和更改字段，外层关闭按钮禁用', async () => {
  const pending = deferred(); const view = fixture({ submit: () => pending.promise }); fillValid(view); view.submit();
  const action = view.button('确认保存演示异常').props.onClick; action({ preventDefault() {} }); action({ preventDefault() {} }); view.render(); assert.equal(view.submissions.length, 1); assert.equal(view.node('DialogContent').props.closeDisabled, true); assert.equal(view.node('form').props['aria-busy'], true); assert.equal(view.field('batchNo').props.disabled, true);
  view.close(); view.node('AlertDialog').props.onOpenChange(false); view.render(); assert.equal(view.node('AlertDialog').props.open, true); assert.deepEqual(view.closes, []);
  let prevented = false; view.node('AlertDialogContent').props.onEscapeKeyDown({ preventDefault() { prevented = true; } }); assert.equal(prevented, true);
  pending.resolve(); await view.settle(); assert.deepEqual(view.closes, [false]);
});

test('父级重复异常或保存失败保持草稿和打开状态，焦点移到错误后允许重试', async () => {
  let fail = true; const view = fixture({ submit: () => { if (fail) throw new Error('同一批次已有异常，请关联现有异常。'); } }); fillValid(view); view.submit(); view.confirm(); await view.settle();
  assert.equal(view.props.open, true); assert.equal(view.node('AlertDialog').props.open, false); assert.equal(view.field('phenomenon').props.value, ' 外径测量超出图纸上限。 '); assert.match(view.text(), /同一批次已有异常/); assert.equal(view.focused.at(-1), 'p'); assert.deepEqual(view.closes, []);
  fail = false; view.submit(); view.confirm(); await view.settle(); assert.equal(view.submissions.length, 2); assert.deepEqual(view.closes, [false]);
});

test('已关闭后外部重新打开恢复初始，表单桌面两列和移动滚动复用现有 Dialog', () => {
  const view = fixture(); view.fill('materialCode', 'MAT-DRAFT'); view.props.open = false; view.render(); view.reopen(); assert.equal(view.field('materialCode').props.value, '');
  assert.match(view.node('DialogContent').props.className, /sm:max-w-3xl/); assert.ok(view.nodes().some((node) => /sm:grid-cols-2/.test(node.props.className ?? ''))); assert.equal(view.node('form').props.noValidate, true);
});

test('只在打开期间通知父级草稿，关闭组件不覆盖其他表单的草稿状态', () => {
  const hidden = fixture({ open: false }); hidden.render(); assert.deepEqual(hidden.dirtyChanges, []);
  const view = fixture(); assert.deepEqual(view.dirtyChanges, [false]); view.fill('materialCode', 'MAT-DRAFT'); assert.equal(view.dirtyChanges.at(-1), true);
  const count = view.dirtyChanges.length; view.props.open = false; view.render(); view.render(); assert.equal(view.dirtyChanges.length, count);
  view.reopen(); assert.equal(view.dirtyChanges.at(-1), false); view.fill('phenomenon', '外观破损'); assert.equal(view.dirtyChanges.at(-1), true);
  view.close(); view.button('放弃登记').props.onClick({ preventDefault() {} }); view.render(); assert.equal(view.dirtyChanges.at(-1), false);
});

test('保存失败保持父级草稿，成功通知已清理；预览数量上限与安全精度模型一致', async () => {
  let fail = true; const view = fixture({ submit: () => { if (fail) throw new Error('保存失败'); } }); fillValid(view);
  const maximum = String(Number.MAX_SAFE_INTEGER / 1000); view.fill('inspectedQty', maximum); view.fill('defectiveQty', maximum);
  view.submit(); assert.equal(view.node('AlertDialog').props.open, true); view.confirm(); await view.settle(); assert.equal(view.dirtyChanges.at(-1), true);
  fail = false; view.submit(); view.confirm(); await view.settle(); assert.equal(view.dirtyChanges.at(-1), false); assert.equal(view.submissions.at(-1).inspectedQty, Number.MAX_SAFE_INTEGER / 1000);
});

test('新建草稿浏览器返回等待父级确认时，不额外弹出登记放弃框或关闭草稿', () => {
  const view = fixture(); view.fill('materialCode', 'MAT-DRAFT'); view.props.navigationPending = true; view.render();
  assert.equal(view.node('DialogContent').props.closeDisabled, true); assert.equal(view.field('materialCode').props.disabled, true);
  for (const handler of ['onInteractOutside', 'onPointerDownOutside', 'onEscapeKeyDown']) { let prevented = false; view.node('DialogContent').props[handler]({ preventDefault() { prevented = true; } }); assert.equal(prevented, true); }
  view.close(); view.submit(); assert.equal(view.node('AlertDialog').props.open, false); assert.deepEqual(view.closes, []); assert.equal(view.field('materialCode').props.value, 'MAT-DRAFT'); assert.equal(view.dirtyChanges.at(-1), true);
  view.props.navigationPending = false; view.render(); assert.equal(view.node('AlertDialog').props.open, false); view.close(); assert.match(text(view.node('AlertDialogTitle')), /放弃尚未保存/); view.cancelConfirmation(); assert.equal(view.field('materialCode').props.value, 'MAT-DRAFT');
});

test('父导航等待期间隐藏已有保存确认，取消导航后恢复核对和正常取消', () => {
  const view = fixture(); fillValid(view); view.submit(); assert.equal(view.node('AlertDialog').props.open, true);
  const beforeFocus = view.focused.length; view.props.navigationPending = true; view.render(); assert.equal(view.node('AlertDialog').props.open, false); assert.equal(view.focused.length, beforeFocus);
  view.node('AlertDialog').props.onOpenChange(false); view.confirm(); view.render(); assert.deepEqual(view.submissions, []); assert.deepEqual(view.closes, []);
  view.props.navigationPending = false; view.render(); assert.equal(view.node('AlertDialog').props.open, true); assert.match(text(view.node('AlertDialogTitle')), /核对质量异常登记/);
  view.cancelConfirmation(); assert.equal(view.node('AlertDialog').props.open, false); assert.equal(view.field('batchNo').props.value, ' B-001 '); assert.equal(view.focused.at(-1), 'Button');
});

test('焦点移向其他模态层不会被误当作指针点击而触发放弃登记', () => {
  const view = fixture(); view.fill('phenomenon', '外观破损'); let prevented = false;
  view.node('DialogContent').props.onInteractOutside({ detail: { originalEvent: { type: 'focusin' } }, preventDefault() { prevented = true; } }); view.render(); assert.equal(prevented, true); assert.equal(view.node('AlertDialog').props.open, false); assert.deepEqual(view.closes, []);
  view.node('DialogContent').props.onPointerDownOutside({ preventDefault() {} }); view.render(); assert.equal(view.node('AlertDialog').props.open, true); view.cancelConfirmation(); assert.equal(view.field('phenomenon').props.value, '外观破损');
});
