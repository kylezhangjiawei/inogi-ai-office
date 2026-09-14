import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
const read = (path) => readFileSync(new URL(`../src/app/production/${path}`, import.meta.url), 'utf8');
const jsx = (type, props, key) => ({ type, props: props ?? {}, key });
const primitives = new Proxy({}, { get: (_, key) => key });
const translate = (value) => value;
const forbidden = () => assert.fail('P04 预览不得访问网络或持久化存储');
const storage = new Proxy({}, { get: forbidden, set: forbidden });
class FixedDate extends Date { constructor(...args) { super(...(args.length ? args : ['2026-09-14T05:00:00.000Z'])); } static now() { return Date.parse('2026-09-14T05:00:00.000Z'); } }
function load(path, imports = {}, window = {}) {
  const exports = {};
  const code = ts.transpileModule(read(path), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  new Function('exports', 'require', 'window', 'fetch', 'localStorage', 'sessionStorage', 'indexedDB', 'Date', code)(exports, (name) => { assert.ok(Object.hasOwn(imports, name), `审查依赖 ${name}`); return imports[name]; }, window, forbidden, storage, storage, storage, FixedDate);
  return exports;
}
const defectsModel = load('defects/defectModel.ts');
const model = load('rd-collaboration/rdModel.ts', { '../defects/defectModel': defectsModel });
const types = load('rd-collaboration/rdTypes.ts');
const shared = { 'react/jsx-runtime': { jsx, jsxs: jsx, Fragment: 'Fragment' }, 'lucide-react': primitives, '../../lib/i18n': { useI18n: () => ({ t: translate }) }, '../../components/ui/button': primitives, '../../components/ui/alert-dialog': primitives, '../../order-processing/components/HorizonPage': primitives, '../../order-processing/horizon.css': {}, './production-rd.css': {}, '../defects/defectModel': defectsModel, './rdModel': model, './rdTypes': types };
const nodes = (tree) => Array.isArray(tree) ? tree.flatMap(nodes) : !tree || typeof tree !== 'object' ? [] : [...(tree.type ? [tree] : []), ...Object.values(tree.props ?? {}).flatMap(nodes)];
const text = (tree) => Array.isArray(tree) ? tree.map(text).join(' ') : typeof tree === 'string' || typeof tree === 'number' ? String(tree) : !tree || typeof tree !== 'object' ? '' : ['children', 'title', 'description', 'actions', 'action'].map((key) => text(tree.props?.[key])).join(' ');
const normalized = (tree) => text(tree).replace(/\s+/g, ' ').trim();
function hookHarness() {
  const slots = [], effects = []; let cursor = 0;
  return { slots, reset() { cursor = 0; }, flush() { while (effects.length) effects.shift()(); }, hooks: {
    useState(initial) { const index = cursor++; if (!(index in slots)) slots[index] = typeof initial === 'function' ? initial() : initial; return [slots[index], (value) => { slots[index] = typeof value === 'function' ? value(slots[index]) : value; }]; },
    useRef(initial) { const index = cursor++; return slots[index] ??= { current: initial }; },
    useCallback(callback, deps) { const index = cursor++, previous = slots[index]; if (!previous || deps.some((value, i) => !Object.is(value, previous.deps[i]))) slots[index] = { callback, deps }; return slots[index].callback; },
    useEffect(effect, deps) { const index = cursor++, previous = slots[index]; if (!previous || deps.some((value, i) => !Object.is(value, previous.deps[i]))) { slots[index] = { deps, cleanup: previous?.cleanup }; effects.push(() => { slots[index].cleanup?.(); slots[index].cleanup = effect(); }); } },
  } };
}
const base = (kind, patch = {}) => ({ kind, issueId: 'issue-process', actorId: 'rd-a', reviewed: true, ...patch });
const assign = () => base('assign', { actorId: 'quality-a', ownerId: 'rd-a', dueDate: '2026-09-16', description: '请核对原异常配合尺寸' });
const opinion = () => base('opinion', { text: '核对定位工装后现场验证', basis: '图纸 V1.2 摘要', drawingChange: 'no', drawingReference: '', sopChange: 'no', sopReference: '' });
function fixture() {
  const harness = hookHarness(), listeners = new Map(); let tree, predicate, pending, location = { pathname: '/__preview/production-rd', search: '' };
  const session = load('defects/defectPreviewSession.ts', { './defectModel': defectsModel });
  const rdSession = load('rd-collaboration/rdPreviewSession.ts', { '../defects/defectPreviewSession': session, './rdModel': model });
  const blocker = { state: 'unblocked', reset() { pending = undefined; blocker.state = 'unblocked'; }, proceed() { location = pending; pending = undefined; blocker.state = 'unblocked'; } };
  const navigate = (next) => { if (predicate?.()) { pending = next; blocker.state = 'blocked'; } else location = next; };
  const page = load('rd-collaboration/ProductionRdPreviewPage.tsx', { ...shared, react: harness.hooks, 'react-router': { Link: 'Link', useSearchParams: () => [new URLSearchParams(location.search), (params) => navigate({ ...location, search: `?${params}` })], useBlocker: (next) => { predicate = next; return blocker; } }, '../defects/defectPreviewSession': session, './rdPreviewSession': rdSession, './RdActionForm': { RdActionForm: 'RdActionForm' } }, { addEventListener: (name, cb) => listeners.set(name, cb), removeEventListener: (name) => listeners.delete(name), requestAnimationFrame: (cb) => cb(), document: { getElementById: () => ({ scrollIntoView() {} }) } });
  const view = { render() { harness.reset(); tree = page.ProductionRdPreviewPage(); harness.flush(); return tree; }, nodes: () => nodes(tree), text: () => normalized(tree), form: () => nodes(tree).find((node) => node.type === 'RdActionForm'), state: () => rdSession.getRdPreviewState(), defects: () => session.getDefectPreviewState(), location: () => location,
    byId: (id) => nodes(tree).find((node) => node.props.id === id), button: (label) => nodes(tree).find((node) => ['Button', 'button', 'AlertDialogAction', 'AlertDialogCancel'].includes(node.type) && normalized(node) === label),
    click(label) { const button = view.button(label); assert.ok(button, `${label} exists`); assert.equal(!!button.props.disabled, false); button.props.onClick?.(); view.render(); },
    actor(id) { view.byId('prd-actor').props.onChange({ target: { value: id } }); view.render(); }, dirty() { view.form().props.onDirtyChange(true); view.render(); },
    async save(action) { await view.form().props.onSubmit(action); view.render(); },
    unload() { let prevented = false; listeners.get('beforeunload')?.({ preventDefault() { prevented = true; } }); return prevented; },
    failNext() { const checkbox = nodes(tree).find((node) => node.type === 'input' && node.props.type === 'checkbox'); checkbox.props.onChange({ target: { checked: true } }); view.render(); },
    navigate(pathname) { navigate({ pathname, search: '' }); view.render(); },
    dialog(title) { return nodes(tree).find((node) => node.type === 'AlertDialog' && normalized(node).includes(title)); },
  }; view.render(); return view;
}

test('初始展示 P08 原过程异常6件，显式指派后研发继续处理', async () => {
  const page = fixture(); assert.match(page.text(), /NC-PRO-0911-003/); assert.match(page.text(), /原不良范围 6 件/); assert.match(page.text(), /待指定研发/);
  page.click('指定研发处理人'); await page.save(assign()); assert.equal(page.defects().collaborations.length, 1); assert.equal(page.state().cases[0].status, 'processing');
  page.actor('rd-a'); assert.ok(page.button('请求补充资料')); assert.ok(page.button('提交技术意见')); assert.equal(page.button('关闭技术协同'), undefined);
});

test('P04 保存失败保留填写与原异常，重试仅执行一次', async () => {
  const page = fixture(); page.click('指定研发处理人'); page.dirty(); page.failNext(); const source = structuredClone(page.defects());
  await assert.rejects(page.save(assign()), /保存失败/); assert.deepEqual(page.defects(), source); assert.ok(page.form()); assert.equal(page.unload(), true);
  // React rerenders the failure toggle before retry; model fixture explicitly flushes it.
  page.render(); await page.save(assign()); assert.equal(page.defects().collaborations.length, 1); assert.equal(page.unload(), false);
});

test('切换操作人先保护填写，放弃后旧回调无法写入', async () => {
  const page = fixture(); page.click('指定研发处理人'); page.dirty(); const oldSubmit = page.form().props.onSubmit;
  page.actor('viewer-a'); assert.equal(page.dialog('放弃尚未保存的填写').props.open, true); assert.equal(page.byId('prd-actor').props.value, 'quality-a');
  page.click('放弃并继续'); assert.equal(page.byId('prd-actor').props.value, 'viewer-a'); assert.equal(page.form(), undefined);
  await assert.rejects(oldSubmit(assign()), /已变化/); assert.equal(page.defects().collaborations.length, 0);
});

test('资料分类切换有未保存保护，确认后不丢失已保存原异常', async () => {
  const page = fixture(); page.click('指定研发处理人'); await page.save(assign()); page.actor('rd-a'); page.click('提交技术意见'); page.dirty();
  page.click('处理记录'); assert.equal(page.dialog('放弃尚未保存的填写').props.open, true); page.click('放弃并继续'); assert.equal(page.form(), undefined); assert.equal(page.defects().collaborations.length, 1);
});

test('跨页来源链接离开前阻断，放弃后保留 P08 共享来源', async () => {
  const page = fixture(); page.click('指定研发处理人'); await page.save(assign()); page.actor('rd-a'); page.click('提交技术意见'); page.dirty();
  page.navigate('/__preview/production-defects'); assert.equal(page.dialog('离开前放弃填写').props.open, true); assert.equal(page.unload(), true);
  page.click('留在本页'); assert.equal(page.location().pathname, '/__preview/production-rd');
  page.navigate('/__preview/production-defects'); page.click('放弃并离开'); assert.equal(page.location().pathname, '/__preview/production-defects'); assert.equal(page.unload(), false); assert.equal(page.defects().collaborations.length, 1);
});

test('技术意见、验证失败、重新验证及关闭完整流不改 P08 不良数量', async () => {
  const page = fixture(); page.click('指定研发处理人'); await page.save(assign()); page.actor('rd-a'); page.click('提交技术意见'); await page.save(opinion());
  page.click('转现场验证'); await page.save(base('send-verification', { verifierId: 'line-b', plannedDate: '2026-09-14' }));
  page.actor('line-b'); page.click('登记现场验证'); await page.save(base('verify', { actorId: 'line-b', date: '2026-09-14', result: 'failed', evidence: '验证记录1', note: '仍有干涉' }));
  page.actor('rd-a'); assert.equal(page.button('转现场验证'), undefined); page.click('提交技术意见'); await page.save(opinion()); page.click('转现场验证'); await page.save(base('send-verification', { verifierId: 'line-b', plannedDate: '2026-09-14' }));
  page.actor('line-b'); page.click('登记现场验证'); await page.save(base('verify', { actorId: 'line-b', date: '2026-09-14', result: 'passed', evidence: '验证记录2', note: '新意见验证通过' }));
  page.actor('quality-a'); page.click('关闭技术协同'); await page.save(base('close', { actorId: 'quality-a', summary: '核对最新现场验证通过' }));
  assert.equal(page.state().cases[0].status, 'closed'); assert.equal(page.defects().issues.find((item) => item.id === 'issue-process').closedAt, undefined); assert.match(page.text(), /P08 尚未解决 6 件/);
});

test('读取失败、空数据及只读均有明确恢复，错误模式不显示写入口', () => {
  const page = fixture(); page.click('只读'); assert.equal(page.button('指定研发处理人'), undefined); page.click('读取失败'); assert.match(page.text(), /读取失败/); assert.equal(page.form(), undefined);
  page.click('重试读取'); assert.ok(page.button('指定研发处理人')); page.click('空数据'); assert.match(page.text(), /当前范围没有研发问题/); page.click('清除筛选'); assert.ok(page.button('指定研发处理人'));
});

test('重置同时清空 P08 来源协同与 P04 技术记录并恢复样例', async () => {
  const page = fixture(); page.click('指定研发处理人'); await page.save(assign()); page.click('重置演示'); assert.equal(page.dialog('重置生产协同演示').props.open, true); page.click('确认重置'); assert.equal(page.state().cases.length, 0); assert.equal(page.defects().collaborations.length, 0); assert.match(page.text(), /原不良范围 6 件/);
});

function formFixture() {
  const harness = hookHarness(); let tree, dirty = false, reject = false, calls = [];
  const defects = defectsModel.createDefectState(), state = model.createRdState();
  const Form = load('rd-collaboration/RdActionForm.tsx', { ...shared, react: harness.hooks }).RdActionForm;
  const props = { state, defects, issueId: 'issue-process', actorId: 'quality-a', kind: 'assign', onDirtyChange(value) { dirty = value; }, async onSubmit(action) { if (reject) throw new Error('保存失败，填写保留'); calls.push(action); }, onCancel() {} };
  const view = { render() { harness.reset(); tree = Form(props); harness.flush(); }, nodes: () => nodes(tree), text: () => normalized(tree), input: (id) => nodes(tree).find((node) => node.props.id === `prd-${id}`), dirty: () => dirty, calls: () => calls,
    fill(id, value) { view.input(id).props.onChange({ target: { value } }); view.render(); }, review() { nodes(tree).find((node) => node.type === 'input' && node.props.type === 'checkbox').props.onChange({ target: { checked: true } }); view.render(); }, fail(value) { reject = value; }, async submit() { await tree.props.onSubmit({ preventDefault() {} }); view.render(); },
  }; view.render(); return view;
}

test('表单必填失败显示关联内联错误，保存失败保持输入并可重试', async () => {
  const form = formFixture(); await form.submit(); assert.equal(form.calls().length, 0); assert.equal(form.input('ownerId').props['aria-invalid'], true); assert.equal(form.input('ownerId').props['aria-describedby'], 'prd-ownerId-error');
  form.fill('ownerId', 'rd-a'); form.fill('description', '复核工装和尺寸'); form.review(); assert.equal(form.dirty(), true); form.fail(true); await form.submit(); assert.match(form.text(), /保存失败/); assert.equal(form.input('description').props.value, '复核工装和尺寸');
  form.fail(false); await form.submit(); assert.equal(form.calls().length, 1); assert.equal(form.calls()[0].issueId, 'issue-process');
});
