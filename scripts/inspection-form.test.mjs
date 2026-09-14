import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
const source = (file) => readFileSync(new URL(`../src/app/production/inspections/${file}`, import.meta.url), 'utf8');
const compile = (value) => ts.transpileModule(value, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
class FixedDate extends Date { constructor(...args) { super(...(args.length ? args : ['2026-09-11T04:00:00.000Z'])); } static now() { return Date.parse('2026-09-11T04:00:00.000Z'); } }
const types = {}, model = {}, fieldTypes = {};
new Function('exports', compile(readFileSync(new URL('../src/app/production/field-tasks/fieldTypes.ts', import.meta.url), 'utf8')))(fieldTypes);
new Function('exports', compile(source('inspectionTypes.ts')))(types);
new Function('exports', 'Date', compile(source('inspectionModel.ts')))(model, FixedDate);
const code = compile(source('InspectionActionForm.tsx'));
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
function fixture({ kind = 'inspect', submit, props: overrides = {} } = {}) {
  const slots = [], submissions = [], dirtyChanges = [], focused = [], domNodes = new Map();
  let cursor = 0, effects = [], tree, cancelled = 0;
  const same = (a, b) => Boolean(a && b && a.length === b.length && a.every((value, i) => Object.is(value, b[i])));
  const react = {
    useState(initial) { const i = cursor++; if (!(i in slots)) slots[i] = typeof initial === 'function' ? initial() : initial; return [slots[i], (value) => { slots[i] = typeof value === 'function' ? value(slots[i]) : value; }]; },
    useRef(initial) { const i = cursor++; return slots[i] ??= { current: initial }; },
    useEffect(callback, deps) { const i = cursor++, previous = slots[i]; if (!same(previous?.deps, deps)) effects.push(() => { previous?.cleanup?.(); slots[i] = { deps, cleanup: callback() }; }); },
  };
  const state = model.createInspectionState();
  state.tasks.find((task) => task.id === 'task-pending').acceptedAt = kind === 'accept' ? undefined : '2026-09-11T01:00:00.000Z';
  const context = { kind, taskId: ['accept', 'inspect'].includes(kind) ? 'task-pending' : kind === 'transfer' ? 'task-process' : kind === 'release' ? 'task-release' : 'task-final', ...(kind === 'transfer' ? { recordId: 'record-process' } : {}), ...(kind === 'reinspect' ? { issueId: 'issue-ready' } : {}) };
  const props = { state, actorId: kind === 'release' ? 'qa-a' : 'qc-a', context, onSubmit: async (input) => { submissions.push(input); await submit?.(input); }, onDirtyChange: (value) => dirtyChanges.push(value), onCancel: () => { cancelled++; }, ...overrides };
  const dependencies = { react, 'react/jsx-runtime': { jsx, jsxs: jsx, Fragment: 'Fragment' }, '../../lib/i18n': { useI18n: () => ({ t }), i18nLocale: () => 'zh-CN' }, '../../components/ui/utils': { cn: (...parts) => parts.filter(Boolean).join(' ') }, './inspectionTypes': types, './inspectionModel': model, '../field-tasks/fieldTypes': fieldTypes };
  const exports = {};
  new Function('exports', 'require', 'FileReader', 'Date', code)(exports, (name) => {
    if (name in dependencies) return dependencies[name]; if (name.endsWith('.css')) return {};
    assert.ok(name === 'lucide-react' || name.startsWith('../../components/ui/'), `No external write dependency: ${name}`); return components;
  }, LocalFileReader, FixedDate);
  const view = {
    props, submissions, dirtyChanges, focused, cancelled: () => cancelled,
    render() {
      const previousOpen = elements(tree).find((node) => node.type === 'AlertDialog')?.props.open;
      cursor = 0; effects = []; tree = exports.InspectionActionForm(props);
      const dom = (node) => { if (!node) return null; const key = node.props.id ?? node.type; if (!domNodes.has(key)) domNodes.set(key, { open: false, focus() { focused.push(key); }, scrollIntoView() {}, querySelector(selector) { return dom(elements(tree).find((item) => `#${item.props?.id}` === selector)); } }); return domNodes.get(key); };
      for (const node of elements(tree)) if (node.props?.ref) node.props.ref.current = dom(node);
      effects.forEach((job) => job()); effects = [];
      if (previousOpen && !view.node('AlertDialog').props.open) view.node('AlertDialogContent').props.onCloseAutoFocus({ preventDefault() {} });
      return tree;
    },
    async settle() { await new Promise((resolve) => setImmediate(resolve)); return view.render(); },
    unmount() { slots.forEach((slot) => slot?.cleanup?.()); },
    text: () => text(tree), nodes: () => elements(tree), node: (type) => elements(tree).find((node) => node.type === type),
    field: (name) => elements(tree).find((node) => node.props?.id === `inspection-action-${name}`),
    selectNode: (name) => elements(tree).find((node) => node.type === 'Select' && elements(node).some((child) => child.props?.id === `inspection-action-${name}`)),
    button: (label) => elements(tree).find((node) => ['Button', 'AlertDialogAction', 'AlertDialogCancel'].includes(node.type) && text(node).trim() === label),
    fill(name, value) { const node = view.field(name); assert.ok(node, `${name} exists`); assert.equal(Boolean(node.props.disabled), false); node.props.onChange({ target: { value } }); return view.render(); },
    select(name, value) { const node = view.selectNode(name); assert.ok(node); assert.equal(Boolean(node.props.disabled), false); node.props.onValueChange(value); return view.render(); },
    check(value = true) { const node = view.field('reviewed'); assert.equal(Boolean(node.props.disabled), false); node.props.onChange({ target: { checked: value } }); return view.render(); },
    choosePhenomenon(label = '装配干涉') { view.button(label).props.onClick(); return view.render(); },
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
  if (kind === 'inspect' || kind === 'reinspect') {
    view.fill('quantity', kind === 'inspect' ? '10' : '2'); view.fill('good', kind === 'inspect' ? '8' : '2'); view.fill('bad', kind === 'inspect' ? '2' : '0');
    view.fill('evidence', ' 功能与关键尺寸按 SIP 完成核对，记录号 RAW-0911-01。 '); view.fill('note', ' 已复核本次实际数量。 ');
  }
  if (kind === 'transfer') view.choosePhenomenon();
  if (kind === 'release') { view.fill('quantity', '6'); view.fill('basis', ' QA 授权记录 QA-0911-01，核对全部检验结果后同意放行。 '); }
  view.check();
}

test('接受、初检、复验、转不良及 QA 放行都经确认，固定岗位与原状态保留', async () => {
  for (const kind of ['accept', 'inspect', 'reinspect', 'transfer', 'release']) {
    let result; const view = fixture({ kind, submit: (action) => { result = model.applyInspectionAction(view.props.state, 1, action); } }); const original = JSON.stringify(view.props.state);
    fillValid(view); view.submit(); assert.equal(view.node('AlertDialog').props.open, true, view.text()); assert.equal(view.submissions.length, 0);
    view.confirm(); await view.settle(); assert.equal(result.version, 2); assert.equal(view.submissions[0].actorId, view.props.actorId); assert.equal(JSON.stringify(view.props.state), original); assert.equal(view.dirtyChanges.at(-1), false);
    assert.equal(view.nodes().find((node) => node.type === 'Button' && node.props.type === 'submit').props.disabled, true);
  }
});

test('初检日期默认北京时间当日，数量须手工输入，缺失错误关联并聚焦数量', () => {
  const view = fixture(); assert.equal(view.field('date').props.value, '2026-09-11'); for (const field of ['quantity', 'good', 'bad']) assert.equal(view.field(field).props.value, '');
  view.submit(); assert.equal(view.focused.at(-1), 'inspection-action-quantity'); assert.equal(view.field('quantity').props['aria-describedby'], 'inspection-action-quantity-error');
  assert.equal(view.field('evidence').props['aria-invalid'], true); assert.equal(view.field('reviewed').props['aria-invalid'], true);
});

test('检验只接受整件数量，超范围或合格不良不平衡不能保存，结论由数量派生', () => {
  const view = fixture(); fillValid(view);
  for (const quantity of ['1.5', '1e1', '-1', '0', '9007199254740992', '21']) { view.fill('quantity', quantity); view.submit(); assert.equal(view.field('quantity').props['aria-invalid'], true, quantity); }
  view.fill('quantity', '10'); view.fill('good', '9'); view.submit(); assert.match(view.text(), /之和须等于/);
  view.fill('good', '8'); view.submit(); assert.match(text(view.node('AlertDialogContent')), /本次结论 不合格/); assert.equal(view.field('conclusion'), undefined);
  view.cancelConfirmation(); view.fill('good', '10'); view.fill('bad', '0'); view.submit(); assert.match(text(view.node('AlertDialogContent')), /本次结论 合格/);
});

test('无效、未来或早于报检的日期拒绝，修改日期会进入确认摘要', () => {
  const view = fixture(); fillValid(view);
  for (const date of ['2026-02-30', '2026-09-12', '2026-09-10']) { view.fill('date', date); view.submit(); assert.equal(view.field('date').props['aria-invalid'], true); }
  view.fill('date', '2026-09-11'); view.submit(); assert.match(text(view.node('AlertDialogContent')), /检验日期 2026-09-11/);
});

test('接受和检验均需核对 SIP，缺少发布依据时不产生检验事实', () => {
  const accepted = fixture({ kind: 'accept' }); accepted.submit(); assert.equal(accepted.field('reviewed').props['aria-invalid'], true); assert.match(accepted.text(), /接受不表示检验已经通过/);
  const state = model.createInspectionState(); const task = state.tasks.find((task) => task.id === 'task-pending'); task.acceptedAt = '2026-09-11T01:00:00.000Z'; task.documents[0].status = 'pending';
  const view = fixture({ props: { state } }); fillValid(view); view.submit(); assert.equal(view.node('AlertDialog').props.open, false); assert.match(view.text(), /尚未发布齐全/); assert.equal(view.field('sipVersion'), undefined);
});

test('复验关联原检验和处置凭据，只追加复验结果，首次合格率及旧 SIP 保留', async () => {
  const state = model.createInspectionState(); state.tasks.find((task) => task.id === 'task-final').documents[0].version = 'V1.1';
  let result; const view = fixture({ kind: 'reinspect', props: { state }, submit: (action) => { result = model.applyInspectionAction(state, 1, action); } }); fillValid(view); view.submit();
  const confirmation = text(view.node('AlertDialogContent')); assert.match(confirmation, /QC-0911-001/); assert.match(confirmation, /DISP-0911-001/); assert.match(confirmation, /V1.0/); assert.match(confirmation, /V1.1/);
  view.confirm(); await view.settle(); const progress = model.getInspectionProgress(result, 'task-final'); assert.equal(progress.firstPassRate, 94); assert.equal(progress.qualified, 49); assert.equal(progress.unresolved, 1); assert.equal(progress.releasable, 0);
  assert.equal(result.records.at(-1).originalId, 'record-initial'); assert.equal(result.records.at(-1).sipVersion, 'V1.1'); assert.equal(result.records[0].sipVersion, 'V1.0');
});

test('复验不能超过已完成处置数量，缺凭据的固定来源显示阻塞且不会聚焦禁用字段', () => {
  const view = fixture({ kind: 'reinspect' }); fillValid(view); view.fill('quantity', '3'); view.fill('good', '3'); view.submit(); assert.match(view.text(), /仅剩 2/); assert.equal(view.focused.at(-1), 'inspection-action-quantity');
  const state = model.createInspectionState(); state.issues.find((issue) => issue.id === 'issue-ready').dispositionCode = undefined;
  const missing = fixture({ kind: 'reinspect', props: { state } }); fillValid(missing); missing.submit(); assert.equal(missing.node('AlertDialog').props.open, false); assert.match(missing.text(), /尚无有效处置凭据/); assert.notEqual(missing.focused.at(-1), 'inspection-action-issueId');
});

test('固定复验和检验记录不可更换，直接回调仍保持原来源', () => {
  for (const [kind, field] of [['reinspect', 'issueId'], ['transfer', 'recordId']]) {
    const view = fixture({ kind }); const select = view.selectNode(field), original = select.props.value; assert.equal(select.props.disabled, true); select.props.onValueChange('other-task-record'); view.render(); assert.equal(view.selectNode(field).props.value, original); assert.equal(view.dirtyChanges.at(-1), false);
  }
});

test('非固定选择只列本任务可用记录，换复验来源后重填数量并重新核对', () => {
  const state = model.createInspectionState(); state.issues.push({ ...state.issues[0], id: 'issue-second', code: 'NCR-SECOND' });
  const view = fixture({ kind: 'reinspect', props: { state, context: { kind: 'reinspect', taskId: 'task-final' } } });
  const options = elements(view.selectNode('issueId')).filter((node) => node.type === 'SelectItem').map((node) => node.props.value); assert.deepEqual(options, ['issue-ready', 'issue-second']);
  view.select('issueId', 'issue-ready'); fillValid(view); view.select('issueId', 'issue-second'); for (const field of ['quantity', 'good', 'bad']) assert.equal(view.field(field).props.value, ''); assert.equal(view.field('reviewed').props.checked, false);
});

test('转不良按原记录全量关联，不重复累计；常见现象说明选填、其他必填', async () => {
  let result; const view = fixture({ kind: 'transfer', submit: (action) => { result = model.applyInspectionAction(view.props.state, 1, action); } });
  assert.equal(view.field('quantity'), undefined); fillValid(view); assert.equal(view.field('description').props.required, false); view.submit(); view.confirm(); await view.settle();
  assert.equal(result.issues.at(-1).quantity, 6); assert.equal(result.issues.at(-1).recordId, 'record-process'); assert.equal(model.getInspectionProgress(result, 'task-process').firstBad, 6); assert.equal(model.getTransferable(result, 'record-process'), 0);
  const other = fixture({ kind: 'transfer' }); fillValid(other); other.choosePhenomenon('其他'); other.submit(); assert.equal(other.field('description').props['aria-invalid'], true); assert.equal(other.field('description').props.required, true);
});

test('QA 放行要求授权依据与核对且不超可放量，不改检验事实', async () => {
  let result; const view = fixture({ kind: 'release', submit: (action) => { result = model.applyInspectionAction(view.props.state, 1, action); } }); view.submit(); assert.equal(view.field('basis').props['aria-invalid'], true); assert.equal(view.field('reviewed').props['aria-invalid'], true);
  fillValid(view); view.fill('quantity', '11'); view.submit(); assert.equal(view.field('quantity').props['aria-invalid'], true); view.fill('quantity', '6'); view.submit(); assert.match(text(view.node('AlertDialogContent')), /不代表实物已经出货/); view.confirm(); await view.settle();
  assert.equal(model.getInspectionProgress(result, 'task-release').releasable, 4); assert.deepEqual(result.records, view.props.state.records); assert.deepEqual(result.issues, view.props.state.issues);
});

test('QC 无权 QA 放行，QA 无权初检；只读、已关闭和失效任务均不可提交', () => {
  const readonly = fixture({ props: { readOnly: true } }); assert.equal(readonly.field('quantity').props.disabled, true); readonly.submit(); assert.equal(readonly.node('AlertDialog').props.open, false); readonly.button('取消填写').props.onClick(); assert.equal(readonly.cancelled(), 1);
  for (const [kind, props] of [['release', { actorId: 'qc-a' }], ['inspect', { actorId: 'qa-a' }], ['inspect', { actorId: 'viewer-a' }], ['inspect', { context: { kind: 'inspect', taskId: 'task-closed' } }], ['inspect', { context: { kind: 'inspect', taskId: 'missing' } }]]) { const view = fixture({ kind, props }); fillValid(view); view.submit(); assert.equal(view.node('AlertDialog').props.open, false); }
});

test('真实本地照片生成缩略图、支持移除，确认提交携带相同字节及名称', async () => {
  let result; const view = fixture({ submit: (action) => { result = model.applyInspectionAction(view.props.state, 1, action); } }); fillValid(view); await view.photos([file('读数1.png'), file('读数2.png')]); assert.equal(view.nodes().filter((node) => node.type === 'img').length, 2); assert.equal(view.node('img').props.src, png);
  view.removePhoto('读数1.png'); view.submit(); assert.match(text(view.node('AlertDialogContent')), /读数2.png/); view.confirm(); await view.settle(); assert.equal(result.records.at(-1).photos.length, 1); assert.equal(result.records.at(-1).photos[0].dataUrl, png);
});

test('照片格式、大小、张数和读取失败就地提示，已有照片与填写内容保留', async () => {
  const view = fixture(); fillValid(view); await view.photos([file()]);
  for (const [files, expected] of [[[{ ...file(), type: 'image/gif' }], /请选择 JPG 或 PNG/], [[{ ...file(), size: 10 * 1024 * 1024 + 1 }], /不超过 10 MB/], [[file('2.png'), file('3.png'), file('4.png')], /最多保留 3 张/], [[{ ...file(), fail: true }], /读取失败/]]) { await view.photos(files); assert.match(view.text(), expected); assert.equal(view.nodes().filter((node) => node.type === 'img').length, 1); assert.equal(view.field('quantity').props.value, '10'); }
});

test('选填备注照片默认折叠，核心数量依据仍直接可见，隐藏字段出错自动展开并聚焦', async () => {
  const view = fixture(); const optional = view.nodes().find((node) => node.type === 'details' && text(node).includes('备注与照片（选填）'));
  assert.equal(optional.props.open, undefined); assert.equal(optional.props.ref.current.open, false);
  assert.ok(elements(optional).some((node) => node.props.id === 'inspection-action-note')); assert.ok(elements(optional).some((node) => node.props.id === 'inspection-action-photos'));
  assert.ok(!elements(optional).some((node) => ['inspection-action-quantity', 'inspection-action-evidence'].includes(node.props.id)));
  fillValid(view); view.fill('note', '长'.repeat(1001)); view.submit(); assert.equal(optional.props.ref.current.open, true); assert.equal(view.focused.at(-1), 'inspection-action-note');
  const upload = fixture(); await upload.photos([{ ...file(), type: 'image/gif' }]); assert.equal(upload.node('details').props.ref.current.open, true); assert.equal(upload.focused.at(-1), 'inspection-action-photos');
});

test('确认后岗位、任务、固定来源、版本或只读变化均阻止旧提交并保留输入', () => {
  for (const patch of [{ actorId: 'qa-a' }, { context: { kind: 'reinspect', taskId: 'task-process', issueId: 'issue-ready' } }, { context: { kind: 'reinspect', taskId: 'task-final', issueId: 'issue-history' } }, { readOnly: true }, { state: { ...model.createInspectionState(), version: 99 } }]) { const view = fixture({ kind: 'reinspect' }); fillValid(view); view.submit(); view.setProps(patch); view.confirm(); assert.equal(view.submissions.length, 0); assert.equal(view.node('AlertDialog').props.open, false); assert.equal(view.field('quantity').props.value, '2'); }
});

test('保存失败保留检验依据与照片，重试成功才清除脏状态', async () => {
  let fail = true; const view = fixture({ submit: () => { if (fail) throw new Error('模拟检验保存失败'); } }); fillValid(view); await view.photos([file()]); view.submit(); view.confirm(); await view.settle(); assert.match(view.text(), /模拟检验保存失败/); assert.match(view.field('evidence').props.value, /RAW-0911-01/); assert.equal(view.nodes().filter((node) => node.type === 'img').length, 1); assert.equal(view.dirtyChanges.at(-1), true);
  fail = false; view.submit(); view.confirm(); await view.settle(); assert.equal(view.submissions.length, 2); assert.equal(view.dirtyChanges.at(-1), false);
});

test('确认期间不能改字段，保存中同步防重复与关闭，成功后不能再次提交', async () => {
  const pending = deferred(); const view = fixture({ submit: () => pending.promise }); fillValid(view); view.submit(); view.field('quantity').props.onChange({ target: { value: '999' } }); view.render(); assert.equal(view.field('quantity').props.value, '10');
  const action = view.node('AlertDialogAction'); action.props.onClick({ preventDefault() {} }); action.props.onClick({ preventDefault() {} }); view.render(); assert.equal(view.submissions.length, 1); view.node('AlertDialog').props.onOpenChange(false); view.render(); assert.equal(view.node('AlertDialog').props.open, true); assert.equal(view.field('quantity').props.disabled, true);
  pending.resolve(); await view.settle(); view.submit(); assert.equal(view.submissions.length, 1);
});

test('取消确认保留内容与焦点，卸载后的保存完成不再通知旧页面', async () => {
  const pending = deferred(); const view = fixture({ submit: () => pending.promise }); fillValid(view); view.submit(); view.cancelConfirmation(); assert.equal(view.focused.at(-1), 'Button'); assert.equal(view.field('quantity').props.value, '10'); view.submit(); view.confirm();
  const count = view.dirtyChanges.length; view.unmount(); pending.resolve(); await new Promise((resolve) => setImmediate(resolve)); assert.equal(view.dirtyChanges.length, count);
});
