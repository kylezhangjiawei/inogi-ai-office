import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
const source = (file) => readFileSync(new URL(`../src/app/production/field-tasks/${file}`, import.meta.url), 'utf8');
const compile = (value) => ts.transpileModule(value, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
class FixedDate extends Date { constructor(...args) { super(...(args.length ? args : ['2026-09-11T04:00:00.000Z'])); } static now() { return Date.parse('2026-09-11T04:00:00.000Z'); } }
const types = {}, model = {};
new Function('exports', compile(source('fieldTypes.ts')))(types);
new Function('exports', 'Date', compile(source('fieldModel.ts')))(model, FixedDate);
const code = compile(source('FieldActionForm.tsx'));
const jsx = (type, props) => typeof type === 'function' ? type(props) : { type, props };
const components = new Proxy({}, { get: (_, name) => name });
const t = (value, params = {}) => value.replace(/\{(\w+)\}/g, (match, name) => params[name] ?? match);
const elements = (tree) => Array.isArray(tree) ? tree.flatMap(elements) : tree && typeof tree === 'object' ? [...(tree.type ? [tree] : []), ...Object.values(tree.props ?? {}).flatMap(elements)] : [];
const text = (tree) => Array.isArray(tree) ? tree.map(text).join(' ') : typeof tree === 'string' || typeof tree === 'number' ? String(tree) : tree && typeof tree === 'object' ? text(tree.props?.children) : '';
const deferred = () => { let resolve; const promise = new Promise((yes) => { resolve = yes; }); return { resolve, promise }; };
const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6lUAAAAAASUVORK5CYII=';
const file = (name = '现场.png') => ({ name, type: 'image/png', size: Buffer.from(png.split(',')[1], 'base64').length, body: png });
class LocalFileReader {
  readyState = 0;
  readAsDataURL(file) { this.readyState = 1; queueMicrotask(() => { if (this.readyState !== 1) return; this.readyState = 2; if (file.fail) this.onerror?.(); else { this.result = file.body; this.onload?.(); } }); }
  abort() { this.readyState = 2; this.onabort?.(); }
}
function fixture({ kind = 'report', submit, props: overrides = {} } = {}) {
  const slots = [], submissions = [], dirtyChanges = [], focused = [];
  let cursor = 0, effects = [], tree, cancelled = 0;
  const same = (a, b) => Boolean(a && b && a.length === b.length && a.every((value, i) => Object.is(value, b[i])));
  const react = {
    useState(initial) { const i = cursor++; if (!(i in slots)) slots[i] = typeof initial === 'function' ? initial() : initial; return [slots[i], (value) => { slots[i] = typeof value === 'function' ? value(slots[i]) : value; }]; },
    useRef(initial) { const i = cursor++; return slots[i] ??= { current: initial }; },
    useEffect(callback, deps) { const i = cursor++, previous = slots[i]; if (!same(previous?.deps, deps)) effects.push(() => { previous?.cleanup?.(); slots[i] = { deps, cleanup: callback() }; }); },
  };
  const context = { kind, taskId: kind === 'accept' ? 'task-pending' : 'task-active', ...(kind === 'sign' ? { issueId: 'issue-shell-pending' } : {}), ...(kind === 'defect' ? { reportId: 'report-seed' } : {}), ...(kind === 'return' ? { issueId: 'issue-main-signed' } : {}) };
  const props = { state: model.createFieldState(), actorId: kind === 'accept' ? 'line-b-owner' : 'line-a-owner', context, onSubmit: async (input) => { submissions.push(input); await submit?.(input); }, onDirtyChange: (value) => dirtyChanges.push(value), onCancel: () => { cancelled++; }, ...overrides };
  const dependencies = { react, 'react/jsx-runtime': { jsx, jsxs: jsx, Fragment: 'Fragment' }, '../../lib/i18n': { useI18n: () => ({ t }), i18nLocale: () => 'zh-CN' }, '../../components/ui/utils': { cn: (...parts) => parts.filter(Boolean).join(' ') }, './fieldTypes': types, './fieldModel': model };
  const exports = {};
  new Function('exports', 'require', 'FileReader', 'Date', code)(exports, (name) => {
    if (/\/ui\/(?:button|input|native-select|textarea|checkbox|radio-group|slider)$/.test(name)) return { Button: "Button", Input: "Input", NativeSelect: "NativeSelect", Textarea: "Textarea", Checkbox: "Checkbox", RadioGroup: "RadioGroup", RadioGroupItem: "RadioGroupItem", Slider: "Slider" };

    if (name in dependencies) return dependencies[name]; if (name.endsWith('.css')) return {};
    assert.ok(name === 'lucide-react' || name.startsWith('../../components/ui/'), `No external write dependency: ${name}`); return components;
  }, LocalFileReader, FixedDate);
  const view = {
    props, submissions, dirtyChanges, focused, cancelled: () => cancelled,
    render() {
      const previousOpen = elements(tree).find((node) => node.type === 'AlertDialog')?.props.open;
      cursor = 0; effects = []; tree = exports.FieldActionForm(props);
      const dom = (node) => node ? { focus() { focused.push(node.props.id ?? node.type); }, scrollIntoView() {}, querySelector(selector) { return dom(elements(tree).find((item) => `#${item.props?.id}` === selector)); } } : null;
      for (const node of elements(tree)) if (node.props?.ref) node.props.ref.current = dom(node);
      effects.forEach((job) => job()); effects = [];
      if (previousOpen && !view.node('AlertDialog').props.open) view.node('AlertDialogContent').props.onCloseAutoFocus({ preventDefault() {} });
      return tree;
    },
    async settle() { await new Promise((resolve) => setImmediate(resolve)); return view.render(); },
    unmount() { slots.forEach((slot) => slot?.cleanup?.()); },
    text: () => text(tree), nodes: () => elements(tree), node: (type) => elements(tree).find((node) => node.type === type),
    field: (name) => elements(tree).find((node) => node.props?.id === `field-action-${name}`),
    selectNode: (name) => elements(tree).find((node) => node.type === 'Select' && elements(node).some((child) => child.props?.id === `field-action-${name}`)),
    button: (label) => elements(tree).find((node) => ['Button', 'AlertDialogAction', 'AlertDialogCancel'].includes(node.type) && text(node).trim() === label),
    fill(name, value) { const node = view.field(name); assert.ok(node, `${name} exists`); assert.equal(Boolean(node.props.disabled), false); node.props.onChange({ target: { value } }); return view.render(); },
    select(name, value) { const node = view.selectNode(name); assert.ok(node); assert.equal(Boolean(node.props.disabled), false); node.props.onValueChange(value); return view.render(); },
    check(value = true) { const node = view.field('reviewed'); assert.equal(Boolean(node.props.disabled), false); node.props.onCheckedChange(value); return view.render(); },
    choosePhenomenon(label = '装配干涉') { view.button(label).props.onClick(); return view.render(); },
    async photos(files) { await view.field('photos').props.onChange({ target: { files, value: 'chosen' } }); return view.render(); },
    removePhoto(name) { view.nodes().find((node) => node.props?.['aria-label'] === `移除照片 ${name}`).props.onClick(); return view.render(); },
    submit() { view.node('form').props.onSubmit({ preventDefault() {} }); return view.render(); },
    confirm() { view.node('AlertDialogAction').props.onClick({ preventDefault() {} }); return view.render(); },
    saveDraft() { view.button('保存报工草稿').props.onClick(); return view.render(); },
    cancelConfirmation() { view.node('AlertDialog').props.onOpenChange(false); return view.render(); },
    setProps(patch) { Object.assign(props, patch); return view.render(); },
  };
  view.render(); return view;
}
function fillValid(view) {
  const kind = view.props.context.kind;
  if (kind === 'accept' || kind === 'sign') view.check();
  if (kind === 'report') { view.fill('actual', '10'); view.fill('good', '8'); view.fill('bad', '2'); view.fill('note', ' 已核对现场数量。 '); }
  if (kind === 'defect') { view.fill('quantity', '2'); view.choosePhenomenon(); view.fill('description', ' 配合孔存在装配干涉，等待质量判定。 '); }
  if (kind === 'return') { view.fill('quantity', '1.125'); view.fill('reason', ' 现场核对剩余未使用物料。 '); view.check(); }
}

test('接收、签收、报工、不良和退料都经确认提交真实模型，身份固定且原状态不变', async () => {
  for (const kind of ['accept', 'sign', 'report', 'defect', 'return']) {
    let result; const view = fixture({ kind, submit: (action) => { result = model.applyFieldAction(view.props.state, 1, action); } }); const original = JSON.stringify(view.props.state); fillValid(view); view.submit();
    assert.equal(view.node('AlertDialog').props.open, true, view.text()); assert.equal(view.submissions.length, 0); view.confirm(); await view.settle();
    assert.equal(result.version, 2); assert.equal(view.submissions[0].actorId, view.props.actorId); assert.equal(JSON.stringify(view.props.state), original); assert.equal(view.dirtyChanges.at(-1), false);
    assert.equal(view.nodes().find((node) => node.type === 'Button' && node.props.type === 'submit').props.disabled, true);
  }
});

test('日期默认北京时间当日，数量不默认填充，必填错误定位第一数量字段', () => {
  const view = fixture(); assert.equal(view.field('date').props.value, '2026-09-11'); for (const field of ['actual', 'good', 'bad']) assert.equal(view.field(field).props.value, '');
  view.submit(); assert.equal(view.focused.at(-1), 'field-action-actual'); assert.equal(view.field('actual').props['aria-describedby'], 'field-action-actual-error');
});

test('保存不完整草稿不计报工，载入个人草稿后可继续编辑与正式提交', async () => {
  let result; const view = fixture({ submit: (action) => { result = model.applyFieldAction(view.props.state, 1, action); } }); view.fill('actual', '尚未核实'); view.fill('good', '8'); view.saveDraft(); await view.settle();
  assert.equal(view.submissions[0].kind, 'save-draft'); assert.equal(result.reports.length, view.props.state.reports.length); assert.equal(result.drafts['line-a-owner:task-active'].actual, '尚未核实'); assert.match(view.text(), /草稿尚未计入数量/); assert.equal(view.field('actual').props.disabled, false); assert.equal(view.dirtyChanges.at(-1), false);
  view.fill('actual', '10'); assert.equal(view.dirtyChanges.at(-1), true);
  const loaded = fixture({ props: { state: result } }); assert.equal(loaded.field('actual').props.value, '尚未核实'); assert.match(loaded.text(), /已载入/); fillValid(loaded); loaded.submit(); assert.equal(loaded.node('AlertDialog').props.open, true);
});

test('报工拒绝非整数、负数、超剩余和数量不平衡，自检不冒充 QC', () => {
  const view = fixture(); fillValid(view);
  for (const value of ['1.5', '1e1', '-1', '0', '9007199254740992', '21']) { view.fill('actual', value); view.submit(); assert.equal(view.field('actual').props['aria-invalid'], true, value); }
  view.fill('actual', '10'); view.fill('good', '9'); view.submit(); assert.match(view.text(), /之和须等于/); view.fill('good', '8'); view.submit(); assert.match(text(view.node('AlertDialogContent')), /现场自检不等于正式 QC/);
});

test('报工日期无效或未来时拒绝，缺失发布资料不能提交', () => {
  const view = fixture(); fillValid(view); for (const date of ['2026-02-30', '2026-09-12']) { view.fill('date', date); view.submit(); assert.equal(view.field('date').props['aria-invalid'], true); }
  const state = model.createFieldState(); state.tasks.find((task) => task.id === 'task-active').documents[0].status = 'pending'; const missing = fixture({ props: { state } }); fillValid(missing); missing.submit(); assert.equal(missing.node('AlertDialog').props.open, false); assert.match(missing.text(), /尚未发布齐全/);
});

test('派工接收和整单签收必须人工勾选，签收不提供数量编辑且批次缺失可保留', () => {
  for (const kind of ['accept', 'sign']) { const view = fixture({ kind }); view.submit(); assert.equal(view.field('reviewed').props['aria-invalid'], true); assert.equal(view.node('AlertDialog').props.open, false); }
  const view = fixture({ kind: 'sign' }); assert.equal(view.field('quantity'), undefined); fillValid(view); view.submit(); assert.match(text(view.node('AlertDialogContent')), /整单签收量/); assert.match(text(view.node('AlertDialogContent')), /待补齐/);
});

test('固定报工和领料对象不可更换，即使直接调用下拉事件也不改变', () => {
  for (const [kind, field] of [['sign', 'issueId'], ['defect', 'reportId'], ['return', 'issueId']]) { const view = fixture({ kind }); const value = view.selectNode(field).props.value; assert.equal(view.selectNode(field).props.disabled, true); view.selectNode(field).props.onValueChange('other-task-record'); view.render(); assert.equal(view.selectNode(field).props.value, value); assert.equal(view.dirtyChanges.at(-1), false); }
});

test('不良登记限原报工未登记量，保存后总不良不重复增加且来源缺失明确标记', async () => {
  let result; const view = fixture({ kind: 'defect', submit: (action) => { result = model.applyFieldAction(view.props.state, 1, action); } }); fillValid(view); view.fill('quantity', '5'); view.submit(); assert.equal(view.field('quantity').props['aria-invalid'], true); view.fill('quantity', '2'); view.submit(); view.confirm(); await view.settle();
  assert.equal(model.getFieldProgress(result, 'task-active').bad, 4); assert.equal(model.getReportUnregistered(result, 'report-seed'), model.getReportUnregistered(view.props.state, 'report-seed') - 2); assert.equal(result.defects.at(-1).missingLot, true); assert.equal(result.defects.at(-1).issueId, null);
});

test('现象选择其他必须说明，选择已签收来源不清空已填不良数量', () => {
  const view = fixture({ kind: 'defect' }); view.fill('quantity', '2'); view.choosePhenomenon('其他'); view.submit(); assert.equal(view.field('description').props['aria-invalid'], true); assert.match(view.text(), /其他现象说明/);
  view.select('issueId', 'issue-main-signed'); assert.equal(view.field('quantity').props.value, '2');
  const options = elements(view.selectNode('issueId')).filter((node) => node.type === 'SelectItem').map((node) => node.props.value); assert.ok(options.includes('issue-main-signed')); assert.ok(!options.includes('issue-shell-pending'));
});

test('选择标准现象时说明可留空，切换其他后说明才必填', () => {
  const view = fixture({ kind: 'defect' }); view.fill('quantity', '2'); view.choosePhenomenon('装配干涉');
  assert.equal(view.field('description').props.required, false); assert.match(view.text(), /现象说明（选填）/); view.submit(); assert.equal(view.node('AlertDialog').props.open, true);
  view.cancelConfirmation(); view.choosePhenomenon('其他'); assert.equal(view.field('description').props.required, true); view.submit(); assert.equal(view.node('AlertDialog').props.open, false); assert.equal(view.field('description').props['aria-invalid'], true);
});

test('照片读取真实本地字节生成缩略图，可删除后重新选择，保存携带同一内容', async () => {
  const view = fixture({ kind: 'defect' }); fillValid(view); await view.photos([file('证据1.png'), file('证据2.png')]);
  assert.equal(view.nodes().filter((node) => node.type === 'img').length, 2); assert.equal(view.node('img').props.src, png); view.removePhoto('证据1.png'); assert.equal(view.nodes().filter((node) => node.type === 'img').length, 1);
  view.submit(); view.confirm(); await view.settle(); assert.equal(view.submissions[0].photos.length, 1); assert.equal(view.submissions[0].photos[0].dataUrl, png); assert.equal(view.submissions[0].photos[0].name, '证据2.png');
});

test('照片格式、每张大小、总张数和读取失败均显示就地错误并保留已有照片', async () => {
  const view = fixture({ kind: 'defect' }); fillValid(view); await view.photos([file()]);
  for (const [files, expected] of [[[{ ...file(), type: 'image/gif' }], /请选择 JPG 或 PNG/], [[{ ...file(), size: 10 * 1024 * 1024 + 1 }], /不超过 10 MB/], [[file('2.png'), file('3.png'), file('4.png')], /最多保留 3 张/], [[{ ...file(), fail: true }], /读取失败/]]) {
    await view.photos(files); assert.match(view.text(), expected); assert.equal(view.nodes().filter((node) => node.type === 'img').length, 1);
  }
});

test('退料支持三位小数、需现场确认未使用，上限不是实际库存且不按 BOM 自动扣除', async () => {
  let result; const view = fixture({ kind: 'return', submit: (action) => { result = model.applyFieldAction(view.props.state, 1, action); } }); view.fill('quantity', '1.0001'); view.submit(); assert.equal(view.field('quantity').props['aria-invalid'], true); assert.equal(view.field('reason').props['aria-invalid'], true); assert.equal(view.field('reviewed').props['aria-invalid'], true);
  fillValid(view); assert.match(view.text(), /不是实际库存/); view.submit(); view.confirm(); await view.settle(); assert.equal(result.returns.at(-1).quantity, 1.125); assert.deepEqual(result.issues, view.props.state.issues); assert.deepEqual(result.reports, view.props.state.reports);
});

test('只读、跨线角色、关闭或不存在任务不可提交，未知任务不崩溃', () => {
  const readonly = fixture({ props: { readOnly: true } }); assert.equal(readonly.field('actual').props.disabled, true); readonly.submit(); assert.equal(readonly.node('AlertDialog').props.open, false); readonly.button('取消填写').props.onClick(); assert.equal(readonly.cancelled(), 1);
  for (const props of [{ actorId: 'line-b-owner' }, { context: { kind: 'report', taskId: 'task-closed' } }, { context: { kind: 'report', taskId: 'missing' } }]) { const view = fixture({ props }); fillValid(view); view.submit(); assert.equal(view.node('AlertDialog').props.open, false); }
});

test('确认期间身份、上下文、版本或只读变化都拒绝旧提交并保留输入', () => {
  for (const patch of [{ actorId: 'supervisor-a' }, { context: { kind: 'report', taskId: 'task-pending' } }, { readOnly: true }, { state: { ...model.createFieldState(), version: 99 } }]) { const view = fixture(); fillValid(view); view.submit(); view.setProps(patch); view.confirm(); assert.equal(view.submissions.length, 0); assert.equal(view.node('AlertDialog').props.open, false); assert.equal(view.field('actual').props.value, '10'); }
});

test('保存失败保留不良说明和照片，重试成功才清除脏状态', async () => {
  let fail = true; const view = fixture({ kind: 'defect', submit: () => { if (fail) throw new Error('模拟保存失败'); } }); fillValid(view); await view.photos([file()]); view.submit(); view.confirm(); await view.settle();
  assert.match(view.text(), /模拟保存失败/); assert.equal(view.nodes().filter((node) => node.type === 'img').length, 1); assert.equal(view.dirtyChanges.at(-1), true);
  fail = false; view.submit(); view.confirm(); await view.settle(); assert.equal(view.submissions.length, 2); assert.equal(view.dirtyChanges.at(-1), false);
});

test('保存中同步防重复与关闭，确认中的字段回调不能改量，成功不可再提交', async () => {
  const pending = deferred(); const view = fixture({ submit: () => pending.promise }); fillValid(view); view.submit(); view.field('actual').props.onChange({ target: { value: '999' } }); view.render(); assert.equal(view.field('actual').props.value, '10');
  const action = view.node('AlertDialogAction'); action.props.onClick({ preventDefault() {} }); action.props.onClick({ preventDefault() {} }); view.render(); assert.equal(view.submissions.length, 1); view.node('AlertDialog').props.onOpenChange(false); view.render(); assert.equal(view.node('AlertDialog').props.open, true); assert.equal(view.field('actual').props.disabled, true);
  pending.resolve(); await view.settle(); view.submit(); assert.equal(view.submissions.length, 1);
});

test('取消确认保留内容和焦点，组件卸载后完成保存不通知旧父页面', async () => {
  const pending = deferred(); const view = fixture({ submit: () => pending.promise }); fillValid(view); view.submit(); view.cancelConfirmation(); assert.equal(view.focused.at(-1), 'Button'); assert.equal(view.field('actual').props.value, '10'); view.submit(); view.confirm();
  const count = view.dirtyChanges.length; view.unmount(); pending.resolve(); await new Promise((resolve) => setImmediate(resolve)); assert.equal(view.dirtyChanges.length, count);
});
