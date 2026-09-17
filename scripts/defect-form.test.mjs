import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
const source = (file) => readFileSync(new URL(`../src/app/production/defects/${file}`, import.meta.url), 'utf8');
const compile = (value) => ts.transpileModule(value, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
class FixedDate extends Date { constructor(...args) { super(...(args.length ? args : ['2026-09-14T04:00:00.000Z'])); } static now() { return Date.parse('2026-09-14T04:00:00.000Z'); } }
const types = {}, model = {};
new Function('exports', compile(source('defectTypes.ts')))(types);
new Function('exports', 'Date', compile(source('defectModel.ts')))(model, FixedDate);
const code = compile(source('DefectActionForm.tsx'));
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
function fixture({ kind = 'repair', submit, props: overrides = {} } = {}) {
  const slots = [], submissions = [], dirtyChanges = [], focused = [], domNodes = new Map();
  let cursor = 0, effects = [], tree, cancelled = 0;
  const same = (a, b) => Boolean(a && b && a.length === b.length && a.every((value, i) => Object.is(value, b[i])));
  const react = {
    useState(initial) { const i = cursor++; if (!(i in slots)) slots[i] = typeof initial === 'function' ? initial() : initial; return [slots[i], (value) => { slots[i] = typeof value === 'function' ? value(slots[i]) : value; }]; },
    useRef(initial) { const i = cursor++; return slots[i] ??= { current: initial }; },
    useEffect(callback, deps) { const i = cursor++, previous = slots[i]; if (!same(previous?.deps, deps)) effects.push(() => { previous?.cleanup?.(); slots[i] = { deps, cleanup: callback() }; }); },
  };
  const state = model.createDefectState();
  const context = { kind, issueId: kind === 'close' ? 'issue-verified' : kind === 'handoff' ? 'issue-final' : kind === 'repair' ? 'issue-field' : 'issue-process', ...(kind === 'handoff' ? { repairId: 'repair-ready' } : {}) };
  const props = { state, actorId: 'quality-a', context, onSubmit: async (input) => { submissions.push(input); await submit?.(input); }, onDirtyChange: (value) => dirtyChanges.push(value), onCancel: () => { cancelled++; }, ...overrides };
  const dependencies = { react, 'react/jsx-runtime': { jsx, jsxs: jsx, Fragment: 'Fragment' }, '../../lib/i18n': { useI18n: () => ({ t }), i18nLocale: () => 'zh-CN' }, '../../components/ui/utils': { cn: (...parts) => parts.filter(Boolean).join(' ') }, './defectTypes': types, './defectModel': model };
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
      cursor = 0; effects = []; tree = exports.DefectActionForm(props);
      const dom = (node) => { if (!node) return null; const key = node.props.id ?? node.type; if (!domNodes.has(key)) domNodes.set(key, { open: false, focus() { focused.push(key); }, scrollIntoView() {}, querySelector(selector) { return dom(elements(tree).find((item) => `#${item.props?.id}` === selector)); } }); return domNodes.get(key); };
      for (const node of elements(tree)) if (node.props?.ref) node.props.ref.current = dom(node);
      effects.forEach((job) => job()); effects = [];
      if (previousOpen && !view.node('AlertDialog').props.open) view.node('AlertDialogContent').props.onCloseAutoFocus({ preventDefault() {} });
      return tree;
    },
    async settle() { await new Promise((resolve) => setImmediate(resolve)); return view.render(); },
    unmount() { slots.forEach((slot) => slot?.cleanup?.()); },
    text: () => text(tree), nodes: () => elements(tree), node: (type) => elements(tree).find((node) => node.type === type),
    field: (name) => elements(tree).find((node) => node.props?.id === `defect-action-${name}`),
    selectNode: (name) => elements(tree).find((node) => node.type === 'Select' && elements(node).some((child) => child.props?.id === `defect-action-${name}`)),
    button: (label) => elements(tree).find((node) => ['Button', 'AlertDialogAction', 'AlertDialogCancel'].includes(node.type) && text(node).trim() === label),
    fill(name, value) { const node = view.field(name); assert.ok(node, `${name} exists`); assert.equal(Boolean(node.props.disabled), false); node.props.onChange({ target: { value } }); return view.render(); },
    select(name, value) { const node = view.selectNode(name); assert.ok(node); assert.equal(Boolean(node.props.disabled), false); node.props.onValueChange(value); return view.render(); },
    check(value = true) { const node = view.field('reviewed'); assert.equal(Boolean(node.props.disabled), false); node.props.onCheckedChange(value); return view.render(); },
    async photos(files) { await view.field('photos').props.onChange({ target: { files, value: 'chosen' } }); return view.render(); },
    removePhoto(name) { view.nodes().find((node) => node.props?.['aria-label'] === `移除照片 ${name}`).props.onClick(); return view.render(); },
    submit() { view.node('form').props.onSubmit({ preventDefault() {} }); return view.render(); },
    confirm() { view.node('AlertDialogAction').props.onClick({ preventDefault() {} }); return view.render(); },
    cancelConfirmation() { view.node('AlertDialog').props.onOpenChange(false); return view.render(); },
    setProps(patch) { Object.assign(props, patch); return view.render(); },
  };
  view.render(); return view;
}

function fillValid(view) {
  const kind = view.props.context.kind;
  if (kind === 'assign') { view.select('ownerId', 'line-b'); view.fill('dueDate', '2026-09-16'); view.fill('reason', ' 明确 B 线责任人与完成期限。 '); }
  if (kind === 'route') {
    if (!view.props.context.direction) view.select('direction', 'rd');
    const direction = view.selectNode('direction').props.value;
    view.select('ownerId', direction === 'rd' ? 'rd-a' : direction === 'procurement' ? 'procurement-a' : 'line-b');
    view.fill('dueDate', '2026-09-16'); view.fill('description', ' 核对异常样品、图纸版本与试验记录，完成排查后反馈。 ');
  }
  if (kind === 'repair') { view.fill('quantity', '2'); view.fill('description', ' 完成外观返工并核对实物数量。 '); view.fill('basis', ' 现场返工记录 DISP-0914-01。 '); }
  if (kind === 'handoff') view.fill('quantity', '2');
  if (kind === 'close') view.fill('summary', ' 已核对原不良 6 台及对应 QC 合格回执，关闭本问题。 ');
  view.check();
}

test('五类操作必须核对并确认，保存不改写原数量与 QC 历史', async () => {
  for (const kind of ['assign', 'route', 'repair', 'handoff', 'close']) {
    let result; const view = fixture({ kind, submit: (action) => { result = model.applyDefectAction(view.props.state, 1, action); } }); const original = JSON.stringify(view.props.state);
    fillValid(view); view.submit(); assert.equal(view.node('AlertDialog').props.open, true, view.text()); assert.equal(view.submissions.length, 0);
    view.confirm(); await view.settle(); assert.equal(result.version, 2); assert.equal(view.submissions[0].actorId, 'quality-a'); assert.equal(JSON.stringify(view.props.state), original); assert.equal(view.dirtyChanges.at(-1), false);
    assert.deepEqual(result.receipts, view.props.state.receipts); assert.equal(result.issues.find((item) => item.id === view.props.context.issueId).quantity, view.props.state.issues.find((item) => item.id === view.props.context.issueId).quantity);
    assert.equal(view.nodes().find((node) => node.type === 'Button' && node.props.type === 'submit').props.disabled, true);
  }
});

test('整改默认业务当日且数量手工填写，缺失字段关联错误并聚焦说明', () => {
  const view = fixture(); assert.equal(view.field('date').props.value, '2026-09-14'); assert.equal(view.field('quantity').props.value, ''); view.submit();
  assert.equal(view.field('quantity').props['aria-invalid'], true); assert.equal(view.field('description').props['aria-describedby'], 'defect-action-description-error');
  assert.equal(view.focused.at(-1), 'defect-action-description'); assert.equal(view.field('reviewed').props['aria-invalid'], true);
});

test('整改仅接受可用池以内正整数，原不良与已有整改数量同时可读', () => {
  const view = fixture({ props: { context: { kind: 'repair', issueId: 'issue-final' } } }); fillValid(view);
  assert.match(view.text(), /原始不良\s+3 台/); assert.match(view.text(), /本次最多可登记\s+1 台/); assert.match(view.text(), /已有整改记录\s+1\s+条/);
  for (const quantity of ['1.5', '1e1', '-1', '0', '9007199254740992', '2']) { view.fill('quantity', quantity); view.check(); view.submit(); assert.equal(view.field('quantity').props['aria-invalid'], true, quantity); }
  view.fill('quantity', '1'); view.check(); view.submit(); assert.equal(view.node('AlertDialog').props.open, true);
});

test('整改日期不能无效、未来或早于原不良，处理期限不能早于今天', () => {
  const view = fixture(); fillValid(view);
  for (const date of ['2026-02-30', '2026-09-15', '2026-09-10']) { view.fill('date', date); view.check(); view.submit(); assert.equal(view.field('date').props['aria-invalid'], true); }
  const assign = fixture({ kind: 'assign' }); fillValid(assign); assign.fill('dueDate', '2026-09-13'); assign.check(); assign.submit(); assert.equal(assign.field('dueDate').props['aria-invalid'], true);
  assign.fill('dueDate', '2026-09-14'); assign.check(); assign.submit(); assert.equal(assign.node('AlertDialog').props.open, true);
});

test('待确认根因可留空，确认根因才必填，回到待确认清除原值', async () => {
  const view = fixture({ kind: 'route' }); fillValid(view); assert.equal(view.field('cause'), undefined); view.submit(); assert.equal(view.node('AlertDialog').props.open, true); assert.match(text(view.node('AlertDialogContent')), /根因状态 待确认/);
  view.cancelConfirmation(); view.select('causeStatus', 'confirmed'); view.check(); view.submit(); assert.equal(view.field('cause').props['aria-invalid'], true);
  view.fill('cause', ' 已完成试验验证：定位销与工装基准偏移。 '); view.check(); view.submit(); assert.match(text(view.node('AlertDialogContent')), /确认根因 已完成试验验证/);
  view.cancelConfirmation(); view.select('causeStatus', 'pending'); view.check(); view.submit(); view.confirm(); await view.settle(); assert.equal(view.submissions[0].cause, ''); assert.equal(view.submissions[0].causeStatus, 'pending');
});

test('方向只列匹配责任岗位，更换方向清空责任人与核对，指派按当前方向筛选', () => {
  const view = fixture({ kind: 'route' }); view.select('direction', 'onsite'); const ids = () => elements(view.selectNode('ownerId')).filter((node) => node.type === 'SelectItem').map((node) => node.props.value);
  assert.deepEqual(ids(), ['quality-a', 'line-b']); view.select('ownerId', 'line-b'); view.check(); view.select('direction', 'rd'); assert.equal(view.selectNode('ownerId').props.value, ''); assert.equal(view.field('reviewed').props.checked, false); assert.deepEqual(ids(), ['rd-a']);
  view.select('direction', 'procurement'); assert.deepEqual(ids(), ['procurement-a']);
  const assign = fixture({ kind: 'assign', props: { context: { kind: 'assign', issueId: 'issue-field' } } }); assert.deepEqual(elements(assign.selectNode('ownerId')).filter((node) => node.type === 'SelectItem').map((node) => node.props.value), ['quality-a', 'line-a']);
});

test('快捷方向不可更换，研发及采购协同形成关联记录且保留原数量', async () => {
  for (const direction of ['rd', 'procurement']) {
    let result; const view = fixture({ kind: 'route', props: { context: { kind: 'route', issueId: 'issue-process', direction } }, submit: (action) => { result = model.applyDefectAction(view.props.state, 1, action); } });
    assert.equal(view.selectNode('direction').props.disabled, true); view.selectNode('direction').props.onValueChange('onsite'); view.render(); assert.equal(view.selectNode('direction').props.value, direction);
    fillValid(view); view.submit(); view.confirm(); await view.settle(); assert.equal(result.collaborations.at(-1).direction, direction); assert.equal(result.collaborations.at(-1).issueId, 'issue-process'); assert.equal(result.issues.find((item) => item.id === 'issue-process').quantity, 6);
  }
});

test('待交接或待复验不良不可改换处理方向，固定方向错误显示表单提示', () => {
  const view = fixture({ kind: 'route', props: { context: { kind: 'route', issueId: 'issue-final', direction: 'rd' } } }); fillValid(view); view.submit(); assert.equal(view.node('AlertDialog').props.open, false); assert.match(view.text(), /暂不能更换处理方向/); assert.notEqual(view.focused.at(-1), 'defect-action-direction');
});

test('复验交接固定原整改记录，超可用数量不能提交，成功后保持待 QC', async () => {
  let result; const view = fixture({ kind: 'handoff', submit: (action) => { result = model.applyDefectAction(view.props.state, 1, action); } });
  assert.equal(view.selectNode('repairId').props.disabled, true); view.selectNode('repairId').props.onValueChange('repair-verified'); view.render(); assert.equal(view.selectNode('repairId').props.value, 'repair-ready');
  fillValid(view); view.fill('quantity', '3'); view.check(); view.submit(); assert.match(view.text(), /仅剩 2 台/); view.fill('quantity', '2'); view.check(); view.submit(); assert.match(text(view.node('AlertDialogContent')), /待 QC 复验/); view.confirm(); await view.settle();
  const p = model.getDefectProgress(result, 'issue-final'); assert.equal(p.pendingReinspection, 2); assert.equal(p.resolved, 0); assert.equal(p.remaining, 3); assert.equal(p.ready, 0); assert.equal(view.field('good'), undefined); assert.equal(view.field('bad'), undefined);
});

test('非固定整改记录仅列当前不良可用记录，更换时清空交接数量与核对', () => {
  const state = model.createDefectState(); state.repairs.push({ ...state.repairs[0], id: 'repair-second', code: 'DISP-SECOND', quantity: 1 });
  const view = fixture({ kind: 'handoff', props: { state, context: { kind: 'handoff', issueId: 'issue-final' } } }); assert.deepEqual(elements(view.selectNode('repairId')).filter((node) => node.type === 'SelectItem').map((node) => node.props.value), ['repair-ready', 'repair-second']);
  view.select('repairId', 'repair-ready'); fillValid(view); view.select('repairId', 'repair-second'); assert.equal(view.field('quantity').props.value, ''); assert.equal(view.field('reviewed').props.checked, false);
});

test('未解决不良不可关闭，QC 全部合格回执才允许且提示关闭不等于放行', () => {
  const view = fixture({ kind: 'close', props: { context: { kind: 'close', issueId: 'issue-final' } } }); fillValid(view); view.submit(); assert.equal(view.node('AlertDialog').props.open, false); assert.match(view.text(), /全部取得 QC 合格回执后才能关闭/);
  const closed = fixture({ kind: 'close' }); fillValid(closed); closed.submit(); assert.match(text(closed.node('AlertDialogContent')), /关闭不良不代表 QA 放行或已经出货/);
});

test('只读、关闭、失效不良及错误岗位均不提交；同线非责任人不能越权', () => {
  const readonly = fixture({ props: { readOnly: true } }); assert.equal(readonly.field('quantity').props.disabled, true); readonly.submit(); assert.equal(readonly.node('AlertDialog').props.open, false); readonly.button('取消填写').props.onClick(); assert.equal(readonly.cancelled(), 1);
  for (const patch of [{ actorId: 'qc-a' }, { actorId: 'viewer-a' }, { actorId: 'line-b' }, { context: { kind: 'repair', issueId: 'issue-closed' } }, { context: { kind: 'repair', issueId: 'missing' } }]) { const view = fixture({ props: patch }); fillValid(view); view.submit(); assert.equal(view.node('AlertDialog').props.open, false); }
  const assign = fixture({ kind: 'assign', props: { actorId: 'line-b' } }); fillValid(assign); assign.submit(); assert.equal(assign.node('AlertDialog').props.open, false);
});

test('本地照片生成缩略图并可移除，确认保留相同名称及字节', async () => {
  let result; const view = fixture({ submit: (action) => { result = model.applyDefectAction(view.props.state, 1, action); } }); fillValid(view); await view.photos([file('整改1.png'), file('整改2.png')]); assert.equal(view.nodes().filter((node) => node.type === 'img').length, 2); assert.equal(view.node('img').props.src, png);
  view.removePhoto('整改1.png'); view.check(); view.submit(); assert.match(text(view.node('AlertDialogContent')), /整改2.png/); view.confirm(); await view.settle(); assert.equal(result.repairs.at(-1).photos.length, 1); assert.equal(result.repairs.at(-1).photos[0].dataUrl, png);
});

test('照片格式大小数量及读取错误就地展示，已选照片与说明保留', async () => {
  const view = fixture(); fillValid(view); await view.photos([file()]);
  for (const [files, expected] of [[[{ ...file(), type: 'image/gif' }], /请选择 JPG 或 PNG/], [[{ ...file(), size: 10 * 1024 * 1024 + 1 }], /不超过 10 MB/], [[file('2.png'), file('3.png'), file('4.png')], /最多保留 3 张/], [[{ ...file(), fail: true }], /读取失败/]]) { await view.photos(files); assert.match(view.text(), expected); assert.equal(view.nodes().filter((node) => node.type === 'img').length, 1); assert.equal(view.field('quantity').props.value, '2'); }
});

test('照片默认折叠且核心字段可见，隐藏照片错误自动展开并聚焦', async () => {
  const view = fixture(); const optional = view.node('details'); assert.equal(optional.props.open, undefined); assert.equal(optional.props.ref.current.open, false); assert.ok(elements(optional).some((node) => node.props.id === 'defect-action-photos')); assert.ok(!elements(optional).some((node) => node.props.id === 'defect-action-basis'));
  await view.photos([{ ...file(), type: 'image/gif' }]); assert.equal(optional.props.ref.current.open, true); assert.equal(view.focused.at(-1), 'defect-action-photos');
  const corrupt = fixture(); fillValid(corrupt); await corrupt.photos([{ ...file(), size: 2 }]); corrupt.check(); corrupt.submit(); assert.equal(corrupt.field('photos').props['aria-invalid'], true); assert.equal(corrupt.node('details').props.ref.current.open, true);
});

test('确认后岗位、不良、固定关联、只读或版本改变阻止旧提交并保留输入', () => {
  for (const patch of [{ actorId: 'qc-a' }, { context: { kind: 'handoff', issueId: 'issue-process', repairId: 'repair-ready' } }, { context: { kind: 'handoff', issueId: 'issue-final', repairId: 'repair-verified' } }, { readOnly: true }, { state: { ...model.createDefectState(), version: 99 } }]) { const view = fixture({ kind: 'handoff' }); fillValid(view); view.submit(); view.setProps(patch); view.confirm(); assert.equal(view.submissions.length, 0); assert.equal(view.node('AlertDialog').props.open, false); assert.equal(view.field('quantity').props.value, '2'); }
});

test('保存失败保留整改依据和照片，重试成功才清除脏状态', async () => {
  let fail = true; const view = fixture({ submit: () => { if (fail) throw new Error('模拟整改保存失败'); } }); fillValid(view); await view.photos([file()]); view.check(); view.submit(); view.confirm(); await view.settle(); assert.match(view.text(), /模拟整改保存失败/); assert.match(view.field('basis').props.value, /DISP-0914-01/); assert.equal(view.nodes().filter((node) => node.type === 'img').length, 1); assert.equal(view.dirtyChanges.at(-1), true);
  fail = false; view.submit(); view.confirm(); await view.settle(); assert.equal(view.submissions.length, 2); assert.equal(view.dirtyChanges.at(-1), false);
});

test('确认时字段锁定，保存同步防重复关闭，成功后不能重复提交', async () => {
  const pending = deferred(); const view = fixture({ submit: () => pending.promise }); fillValid(view); view.submit(); view.field('quantity').props.onChange({ target: { value: '999' } }); view.render(); assert.equal(view.field('quantity').props.value, '2');
  const action = view.node('AlertDialogAction'); action.props.onClick({ preventDefault() {} }); action.props.onClick({ preventDefault() {} }); view.render(); assert.equal(view.submissions.length, 1); view.node('AlertDialog').props.onOpenChange(false); view.render(); assert.equal(view.node('AlertDialog').props.open, true); assert.equal(view.field('quantity').props.disabled, true);
  pending.resolve(); await view.settle(); view.submit(); assert.equal(view.submissions.length, 1);
});

test('取消确认保留内容与焦点，卸载后的异步完成不再通知旧页', async () => {
  const pending = deferred(); const view = fixture({ submit: () => pending.promise }); fillValid(view); view.submit(); view.cancelConfirmation(); assert.equal(view.focused.at(-1), 'Button'); assert.equal(view.field('quantity').props.value, '2'); view.submit(); view.confirm();
  const count = view.dirtyChanges.length; view.unmount(); pending.resolve(); await new Promise((resolve) => setImmediate(resolve)); assert.equal(view.dirtyChanges.length, count);
});

test('照片异步读取中上下文切换，不把旧照片放入新不良', async () => {
  const view = fixture(); const read = view.field('photos').props.onChange({ target: { files: [file()], value: 'selected' } }); view.setProps({ context: { kind: 'repair', issueId: 'issue-final' } }); await read; view.render(); assert.equal(view.nodes().filter((node) => node.type === 'img').length, 0); assert.match(view.text(), /关联对象已变化/);
});

test('保留的旧确认回调在岗位切换后也不能提交，旧操作不会写入新上下文', () => {
  const view = fixture(); fillValid(view); view.submit(); const staleConfirm = view.node('AlertDialogAction').props.onClick;
  view.setProps({ actorId: 'qc-a' }); staleConfirm({ preventDefault() {} }); view.render(); assert.equal(view.submissions.length, 0); assert.equal(view.node('AlertDialog').props.open, false); assert.equal(view.field('quantity').props.value, '2');
});
