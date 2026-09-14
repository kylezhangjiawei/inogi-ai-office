import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

const read = (name) => readFileSync(new URL(`../src/app/${name}`, import.meta.url), 'utf8');
const base = 'production/ecn/';
const compile = (source) => ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
const jsx = (type, props, key) => ({ type, props: props ?? {}, key });
const primitives = new Proxy({}, { get: (_, key) => key });
const translate = (value, params = {}) => value.replace(/\{(\w+)\}/g, (match, key) => params[key] ?? match);
const noExternal = () => assert.fail('档案预览不得访问正式接口或持久化存储');
const noStorage = new Proxy({}, { get: noExternal, set: noExternal });
function evaluate(code, dependencies = {}, env = {}) {
  const exports = {};
  new Function('exports', 'require', 'window', 'URL', 'fetch', 'localStorage', 'sessionStorage', 'indexedDB', code)(exports, (name) => {
    assert.ok(Object.hasOwn(dependencies, name), `未审查的依赖 ${name}`); return dependencies[name];
  }, env.window ?? {}, env.URL ?? URL, noExternal, noStorage, noStorage, noStorage);
  return exports;
}
const types = evaluate(compile(read(`${base}ecnTypes.ts`)));
const model = evaluate(compile(read(`${base}ecnModel.ts`)));
const pageCode = compile(read(`${base}EcnPreviewPage.tsx`));
const shared = {
  'react/jsx-runtime': { jsx, jsxs: jsx, Fragment: 'Fragment' }, 'lucide-react': primitives,
  '../../lib/i18n': { useI18n: () => ({ t: translate }), i18nLocale: () => 'zh-CN' },
  '../../components/ui/utils': { cn: (...values) => values.filter(Boolean).join(' ') },
  './ecnModel': model, './ecnTypes': types,
};
const section = evaluate(compile(read(`${base}EcnSections.tsx`)), { ...shared, '../../components/ui/button': primitives, './ecn-sections.css': {} });
function nodes(tree) {
  if (Array.isArray(tree)) return tree.flatMap(nodes);
  if (!tree || typeof tree !== 'object') return [];
  return [...(tree.type ? [tree] : []), ...Object.values(tree.props ?? {}).flatMap(nodes)];
}
function text(tree) {
  if (Array.isArray(tree)) return tree.map(text).join(' ');
  if (typeof tree === 'string' || typeof tree === 'number') return String(tree);
  if (!tree || typeof tree !== 'object') return '';
  return [tree.props?.children, tree.props?.title, tree.props?.description, tree.props?.actions, tree.props?.action].map(text).join(' ');
}
const normalized = (tree) => text(tree).replace(/\s+/g, ' ').trim();
function fixture(initialSearch = '') {
  const slots = [], effects = [], listeners = new Map(), downloads = [], blobs = [], revoked = [], navigations = [], scrolls = [];
  let cursor = 0, tree, predicate, pending, location = { pathname: '/__preview/ecn', search: initialSearch }, exportFails = false;
  const blocker = { state: 'unblocked', reset() { pending = undefined; blocker.state = 'unblocked'; }, proceed() { assert.ok(pending); location = pending; pending = undefined; blocker.state = 'unblocked'; } };
  const navigate = (next) => { navigations.push(next); if (predicate?.({ currentLocation: location, nextLocation: next })) { pending = next; blocker.state = 'blocked'; } else location = next; };
  const hooks = {
    useState(initial) { const index = cursor++; if (!(index in slots)) slots[index] = typeof initial === 'function' ? initial() : initial; return [slots[index], (value) => { slots[index] = typeof value === 'function' ? value(slots[index]) : value; }]; },
    useRef(initial) { const index = cursor++; return slots[index] ??= { current: initial }; },
    useCallback(callback, deps) { const index = cursor++, old = slots[index]; if (!old || deps.some((value, i) => !Object.is(value, old.deps[i]))) slots[index] = { callback, deps }; return slots[index].callback; },
    useEffect(effect, deps) { const index = cursor++, old = slots[index]; if (!old || deps.some((value, i) => !Object.is(value, old.deps[i]))) { slots[index] = { deps, cleanup: old?.cleanup }; effects.push(() => { slots[index].cleanup?.(); slots[index].cleanup = effect(); }); } },
  };
  const dependencies = { ...shared, react: hooks,
    'react-router': { useSearchParams: () => [new URLSearchParams(location.search), (params) => navigate({ ...location, search: `?${params}` })], useBlocker: (next) => { predicate = next; return blocker; }, Link: 'Link' },
    '../../order-processing/components/HorizonPage': primitives,
    './EcnSections': { EcnSections: 'EcnSections' }, './EcnActionForm': { EcnActionForm: 'EcnActionForm' },
    '../../order-processing/horizon.css': {}, './ecn-preview.css': {},
  };
  for (const name of ['alert-dialog', 'button', 'input', 'label', 'select', 'sheet', 'tabs']) dependencies[`../../components/ui/${name}`] = primitives;
  const exports = evaluate(pageCode, dependencies, { window: {
    addEventListener: (name, handler) => listeners.set(name, handler), removeEventListener: (name, handler) => { if (listeners.get(name) === handler) listeners.delete(name); },
    document: { createElement(name) { assert.equal(name, 'a'); const link = { click() { downloads.push({ href: link.href, download: link.download }); }, remove() {} }; return link; }, body: { appendChild() {} }, getElementById(id) { assert.ok(nodes(tree).some((node) => node.props.id === id), `滚动目标 ${id} 存在`); return { scrollIntoView(options) { scrolls.push({ id, options }); } }; } },
    setTimeout(callback) { callback(); },
    requestAnimationFrame(callback) { callback(); },
  }, URL: { createObjectURL(blob) { if (exportFails) throw new Error('download unavailable'); blobs.push(blob); return `blob:archive-${blobs.length}`; }, revokeObjectURL(url) { revoked.push(url); } } });
  const view = {
    render() { cursor = 0; tree = exports.EcnPreviewPage(); while (effects.length) effects.shift()(); return tree; },
    nodes: () => nodes(tree), text: () => normalized(tree), byType: (type) => nodes(tree).find((node) => node.type === type), byId: (id) => nodes(tree).find((node) => node.props.id === id),
    section: () => view.byType('EcnSections'), form: () => view.byType('EcnActionForm'), state: () => slots.find((value) => value?.records && value?.actors),
    content() { return view.section() ? section.EcnSections(view.section().props) : null; }, contentText() { return normalized(view.content()); },
    sheet: () => view.byType('Sheet'), params: () => new URLSearchParams(location.search), location: () => ({ ...location }), downloads, blobs, revoked, navigations, scrolls,
    button(label) { return view.nodes().find((node) => ['Button', 'button', 'AlertDialogAction', 'AlertDialogCancel'].includes(node.type) && (node.props['aria-label'] === label || normalized(node) === label)); },
    click(label) { const node = view.button(label); assert.ok(node, `${label} exists`); assert.equal(Boolean(node.props.disabled), false, `${label} enabled`); node.props.onClick(); return view.render(); },
    input(value) { view.byId('ecn-query').props.onChange({ target: { value } }); return view.render(); },
    select(controlId, value) { const control = view.nodes().find((node) => node.type === 'Select' && nodes(node).some((child) => child.props.id === controlId)); assert.ok(control, controlId); control.props.onValueChange(value); return view.render(); },
    tab(tab) { view.byType('Tabs').props.onValueChange(tab); return view.render(); },
    action(context) { view.section().props.onAction(context); return view.render(); },
    dirty(value = true) { view.form().props.onDirtyChange(value); return view.render(); },
    discardDialog: () => view.nodes().find((node) => node.type === 'AlertDialog' && /放弃尚未保存/.test(normalized(node))),
    cancelDiscard() { view.discardDialog().props.onOpenChange(false); return view.render(); },
    discard() { view.click('放弃并继续'); return view.render(); },
    failNext() { view.nodes().find((node) => node.type === 'input' && node.props.type === 'checkbox').props.onChange({ target: { checked: true } }); return view.render(); },
    failExport(value = true) { exportFails = value; },
    inputAction(patch = {}) { const props = view.form().props, kind = props.context.kind; return { kind, actorId: props.actorId, ...({ acknowledge: { reviewed: true, impactIds: ['impact-new', 'impact-old'], note: '已核对指定新版与保留旧版范围' }, disposition: { targetId: props.context.targetId ?? 'legacy-stock', choice: 'retain', reason: '原版本保留使用，已有批次不改版' }, feedback: { impactId: props.context.impactId ?? 'impact-new', ownerId: 'process-a', dueDate: '2999-09-12', description: '定位工装尚未覆盖新版尺寸，需要核实' }, 'resolve-task': { taskId: props.context.taskId ?? 'task-seed', resolution: '已补齐工装和作业说明，交质量重新验证' }, verify: { impactId: props.context.impactId ?? 'impact-new', result: 'passed', evidenceId: 'verification-new', note: '按已发布且覆盖本批的验证记录核对' }, archive: { reason: '确认所有范围、处置、协同与验证依据已归集' } }[kind]), ...patch }; },
    async save(patch = {}) { try { await view.form().props.onSubmit(view.inputAction(patch)); } finally { view.render(); } },
    navigate(search, pathname = location.pathname) { navigate({ pathname, search }); return view.render(); },
    unload() { const event = { prevented: false, preventDefault() { this.prevented = true; } }; listeners.get('beforeunload')?.(event); return event.prevented; },
    metric(label) { const dl = view.nodes().find((node) => node.type === 'dl' && node.props.className === 'ecn-review-grid'); const pair = nodes(dl).find((node) => node.type === 'div' && normalized(node.props.children?.[0]) === label); return normalized(pair?.props.children?.[1]); },
  };
  view.render(); return view;
}

const current = (page) => page.state().records.find((record) => record.id === page.section()?.props.recordId);
const sectionButton = (page, label) => nodes(page.content()).find((node) => node.type === 'Button' && (node.props['aria-label'] === label || normalized(node) === label));
const sectionClick = (page, label) => { const button = sectionButton(page, label); assert.ok(button, label); assert.equal(Boolean(button.props.disabled), false); button.props.onClick(); page.render(); };
const role = (page, actorId) => page.select('ecn-actor', actorId);
async function resolveSeed(page) { role(page, 'process-a'); page.action({ kind: 'resolve-task', taskId: 'task-seed' }); await page.save(); }

test('默认已发布 ECN 有五标签、真实差异摘要及独立已阅和验证进度', () => {
  const page = fixture(); assert.equal(current(page).id, 'ecn-01'); assert.equal(page.nodes().filter((node) => node.type === 'TabsTrigger').length, 5);
  assert.equal(page.metric('岗位已阅'), '1 / 3'); assert.equal(page.metric('执行验证通过'), '0 / 1'); assert.match(page.contentText(), /变更前.*变更后/); assert.match(page.contentText(), /图纸原文件待接入/); assert.match(page.text(), /不发送外部通知/);
  assert.equal(nodes(page.content()).filter((node) => node.type === 'img' || node.type === 'iframe').length, 0);
});

test('编号、物料、影响批次和旧订单可检索，未匹配不会保留旧操作', () => {
  const page = fixture(); for (const value of ['ECN-202609-003', 'PO-202609-026', 'B-FG-0902']) { page.input(value); assert.equal(current(page).id, 'ecn-01'); }
  page.input('不存在的变更'); assert.equal(page.section(), undefined); assert.equal(page.button('确认已阅与适用范围'), undefined); assert.equal(page.button('导出变更记录').props.disabled, true); assert.match(page.text(), /没有匹配的 ECN/); page.click('返回演示记录'); assert.equal(current(page).id, 'ecn-01');
  page.select('ecn-status', 'draft'); assert.equal(current(page).id, 'ecn-02'); assert.equal(page.section().props.readOnly, true);
});

test('未知 ECN 链接显示恢复入口，未知标签默认变更对比', () => {
  const page = fixture('?ecn=missing&tab=scope'); assert.equal(page.section(), undefined); assert.match(page.text(), /未找到这个变更/); page.click('返回演示记录'); assert.equal(current(page).id, 'ecn-01'); assert.equal(page.section().props.tab, 'scope');
  assert.equal(fixture('?tab=invalid').section().props.tab, 'comparison');
});

test('本人确认全部范围只更新已阅，不改验证、版本、批次及库存处置', async () => {
  const page = fixture(), original = structuredClone(current(page)); page.click('确认已阅与适用范围'); await page.save();
  assert.equal(page.form(), undefined); assert.equal(page.section().props.tab, 'confirmations'); assert.equal(page.metric('岗位已阅'), '2 / 3'); assert.equal(page.metric('执行验证通过'), '0 / 1');
  assert.deepEqual(current(page).documents, original.documents); assert.deepEqual(current(page).impacts, original.impacts); assert.deepEqual(current(page).dispositions, original.dispositions); assert.equal(current(page).events.at(-1).kind, 'acknowledge');
  assert.equal(page.button('本人已完成已阅确认').props.disabled, true);
});

test('只确认新批保留旧批未读时显示部分确认，补齐旧范围才完成岗位已阅', async () => {
  const page = fixture(); page.click('确认已阅与适用范围'); await page.save({ impactIds: ['impact-new'] }); assert.equal(page.metric('岗位已阅'), '1 / 3'); assert.match(page.contentText(), /部分范围已确认/);
  page.click('确认已阅与适用范围'); await page.save({ impactIds: ['impact-old'] }); assert.equal(page.metric('岗位已阅'), '2 / 3'); assert.match(page.contentText(), /适用范围已确认/);
});

test('旧版处置按工艺或质量角色开放，决定留档而不改变原对象', async () => {
  const page = fixture(); page.tab('scope'); assert.equal(sectionButton(page, `记录处置 ${current(page).legacyTargets[0].code}`), undefined); role(page, 'process-a');
  const target = current(page).legacyTargets[0], original = structuredClone(current(page).legacyTargets); sectionClick(page, `记录处置 ${target.code}`); await page.save();
  assert.equal(page.section().props.tab, 'scope'); assert.deepEqual(current(page).legacyTargets, original); assert.equal(current(page).dispositions.at(-1).targetId, target.id); assert.match(page.contentText(), /按旧版保留使用/);
  role(page, 'quality-a'); assert.ok(sectionButton(page, `记录处置 ${target.code}`)); role(page, 'buyer-a'); assert.equal(sectionButton(page, `记录处置 ${target.code}`), undefined);
});

test('反馈实际生成可查看待办与责任人，处理后仍不自动通过验证', async () => {
  const page = fixture(); page.click('反馈执行问题'); await page.save(); const task = current(page).tasks.at(-1); assert.equal(task.ownerId, 'process-a'); assert.equal(page.section().props.tab, 'tasks'); assert.match(page.contentText(), /定位工装尚未覆盖新版尺寸/); assert.match(page.text(), /尚未发送外部通知/);
  role(page, 'buyer-a'); assert.equal(sectionButton(page, `处理待办 ${task.code}`), undefined); role(page, 'quality-a'); sectionClick(page, `处理待办 ${task.code}`); await page.save(); assert.equal(current(page).tasks.at(-1).status, 'resolved'); assert.equal(page.metric('执行验证通过'), '0 / 1');
});

test('未处理协同阻止验证通过，补处理后质量可独立登记有效依据', async () => {
  const page = fixture(); role(page, 'quality-a'); page.click('登记执行验证'); const original = page.state(); await assert.rejects(page.save(), /未完成的协同/); assert.equal(page.state(), original); page.form().props.onCancel(); page.render();
  await resolveSeed(page); role(page, 'quality-a'); page.action({ kind: 'verify', impactId: 'impact-new' }); await page.save(); assert.equal(page.metric('执行验证通过'), '1 / 1'); assert.match(page.contentText(), /验证通过/); assert.equal(page.metric('岗位已阅'), '1 / 3');
});

test('验证通过后的新执行问题撤销有效验证提示，处理问题不能代替再次验证', async () => {
  const page = fixture(); await resolveSeed(page); role(page, 'quality-a'); page.action({ kind: 'verify', impactId: 'impact-new' }); await page.save();
  page.click('反馈执行问题'); await page.save({ description: '验证后发现新接插件间歇性松动', ownerId: 'quality-a' }); assert.equal(page.metric('执行验证通过'), '0 / 1');
  const task = current(page).tasks.at(-1); sectionClick(page, `处理待办 ${task.code}`); await page.save(); page.tab('confirmations'); assert.equal(page.metric('执行验证通过'), '0 / 1'); assert.match(page.contentText(), /待重新验证/); assert.match(page.contentText(), /历次验证/);
});

test('归档条件未满足保持禁用，补齐后归档仅锁定当前演示变更并保留历史', async () => {
  const page = fixture(); role(page, 'quality-a'); assert.equal(page.button('归档变更').props.disabled, true);
  for (const actorId of ['line-a', 'line-b']) { role(page, actorId); page.click('确认已阅与适用范围'); await page.save(); }
  role(page, 'process-a'); for (const targetId of ['legacy-stock', 'legacy-order']) { page.action({ kind: 'disposition', targetId }); await page.save(); }
  page.action({ kind: 'resolve-task', taskId: 'task-seed' }); await page.save(); role(page, 'quality-a'); page.action({ kind: 'verify', impactId: 'impact-new' }); await page.save();
  assert.equal(page.button('归档变更').props.disabled, false); const impacts = structuredClone(current(page).impacts); page.click('归档变更'); await page.save(); assert.equal(current(page).status, 'archived'); assert.equal(page.section().props.tab, 'history'); assert.deepEqual(current(page).impacts, impacts); assert.equal(page.button('确认已阅与适用范围'), undefined); assert.equal(page.button('归档变更'), undefined); assert.equal(current(page).events.at(-1).kind, 'archive'); assert.match(page.contentText(), /操作前.*操作后/);
});

test('草稿、归档和只读视图均无写操作，资料查看和导出仍可用', () => {
  for (const id of ['ecn-02', 'ecn-03']) { const page = fixture(`?ecn=${id}`); assert.equal(page.section().props.readOnly, true); assert.equal(page.button('确认已阅与适用范围'), undefined); assert.equal(page.button('反馈执行问题'), undefined); for (const tab of ['scope', 'confirmations', 'tasks']) { page.tab(tab); assert.equal(nodes(page.content()).filter((node) => node.type === 'Button' && node.props.onClick && !/^查看资料摘要/.test(node.props['aria-label'] ?? '')).length, 0); } page.click('导出变更记录'); assert.equal(page.downloads.length, 1); }
  const page = fixture(); page.click('只读'); role(page, 'quality-a'); assert.equal(page.button('登记执行验证'), undefined); page.tab('scope'); assert.equal(nodes(page.content()).filter((node) => /^记录处置/.test(node.props['aria-label'] ?? '')).length, 0); page.click('导出变更记录'); assert.equal(page.downloads.length, 1);
});

test('资料摘要显示准确原版本，缺文件不提供伪造图纸预览', () => {
  const page = fixture(), source = current(page).documents[0]; page.section().props.onViewDocument(source.id); page.render(); assert.equal(page.sheet().props.open, true); assert.match(normalized(page.sheet()), new RegExp(source.code)); assert.match(normalized(page.sheet()), new RegExp(source.revision)); assert.match(normalized(page.sheet()), /当前不提供原图预览/); assert.equal(nodes(page.sheet()).filter((node) => ['img', 'iframe'].includes(node.type)).length, 0);
  page.section().props.onViewDocument('missing-document'); page.render(); assert.match(normalized(page.sheet()), /资料尚未归集/); page.click('返回变更'); assert.equal(page.sheet().props.open, false);
});

test('保存失败保留表单与草稿，重试只追加一次动作', async () => {
  const page = fixture(); page.click('确认已阅与适用范围'); page.dirty(); page.failNext(); const original = page.state(), key = page.form().key; await assert.rejects(page.save(), /填写内容已保留/); assert.equal(page.state(), original); assert.equal(page.form().key, key); assert.equal(page.unload(), true); await page.save(); assert.equal(current(page).events.length, 1); assert.equal(page.unload(), false);
});

test('切换操作人、ECN、筛选、标签和预览状态保护未保存填写', () => {
  for (const [change, verify] of [
    [(p) => role(p, 'quality-a'), (p) => assert.equal(p.section().props.actorId, 'quality-a')],
    [(p) => p.select('ecn-record', 'ecn-02'), (p) => assert.equal(current(p).id, 'ecn-02')],
    [(p) => p.input('ECN-202608-011'), (p) => assert.equal(current(p).id, 'ecn-03')],
    [(p) => p.tab('scope'), (p) => assert.equal(p.section().props.tab, 'scope')],
    [(p) => p.click('只读'), (p) => assert.equal(p.section().props.readOnly, true)],
  ]) { const page = fixture(); page.click('反馈执行问题'); page.dirty(); const key = page.form().key; change(page); assert.equal(page.discardDialog().props.open, true); assert.equal(page.form().key, key); page.cancelDiscard(); assert.equal(page.unload(), true); change(page); page.discard(); assert.equal(page.form(), undefined); verify(page); }
});

test('操作人切换与重复旧回调均拒绝旧提交，保留当前状态', async () => {
  const page = fixture(); page.click('确认已阅与适用范围'); const callback = page.form().props.onSubmit, input = page.inputAction(); role(page, 'quality-a'); const original = page.state(); await assert.rejects(callback(input), /已变化/); page.render(); assert.equal(page.state(), original);
  role(page, 'line-a'); page.click('确认已阅与适用范围'); const save = page.form().props.onSubmit, next = page.inputAction(); await save(next); page.render(); const saved = page.state(); await assert.rejects(save(next), /已变化/); page.render(); assert.equal(page.state(), saved);
});

test('已固定旧版对象的表单拒绝向另一对象串写', async () => {
  const page = fixture(); role(page, 'process-a'); page.action({ kind: 'disposition', targetId: 'legacy-stock' }); const original = page.state(); await assert.rejects(page.save({ targetId: 'legacy-order' }), /已变化|对象|范围/); assert.equal(page.state(), original);
});

test('取消后重开相同动作拒绝前一次回调，当前表单仍可保存', async () => {
  const page = fixture(); page.click('反馈执行问题'); const oldForm = page.form(), oldInput = page.inputAction(); oldForm.props.onCancel(); page.render(); page.click('反馈执行问题');
  assert.notEqual(page.form().key, oldForm.key); const original = page.state(); await assert.rejects(oldForm.props.onSubmit(oldInput), /已变化/); page.render(); assert.equal(page.state(), original); assert.ok(page.form());
  await page.save(); assert.equal(current(page).events.length, 1); assert.equal(current(page).events[0].kind, 'feedback');
});

test('固定的待办与批次范围拒绝更换提交对象，普通反馈仍允许选择批次', async () => {
  const page = fixture(); page.click('反馈执行问题'); await page.save({ impactId: 'impact-old' }); const created = current(page).tasks.at(-1); assert.equal(created.impactId, 'impact-old');
  role(page, 'quality-a'); page.action({ kind: 'resolve-task', taskId: 'task-seed' }); let original = page.state(); await assert.rejects(page.save({ taskId: created.id }), /提交对象与当前打开的范围不一致/); assert.equal(page.state(), original);
  page.form().props.onCancel(); page.render(); page.action({ kind: 'verify', impactId: 'impact-new' }); original = page.state(); await assert.rejects(page.save({ impactId: 'impact-old' }), /提交对象与当前打开的范围不一致/); assert.equal(page.state(), original);
});

test('操作历史以中文字段和业务对象显示前后内容，保留处置原因与人员', async () => {
  const page = fixture(); role(page, 'process-a'); page.action({ kind: 'disposition', targetId: 'legacy-stock' }); await page.save({ reason: '技术核对后继续用于已明确保留旧版的批次' });
  page.tab('history'); assert.match(page.contentText(), /操作前.*尚无记录.*操作后/); assert.match(page.contentText(), /旧版对象.*旧库存/); assert.ok(page.contentText().includes(current(page).legacyTargets.find((target) => target.id === 'legacy-stock').code)); assert.match(page.contentText(), /处置决定.*按旧版保留使用/); assert.match(page.contentText(), /依据与原因.*技术核对后继续用于已明确保留旧版的批次/); assert.match(page.contentText(), /操作人.*工艺工程师/); assert.doesNotMatch(page.contentText(), /"targetId"|"actorId"|"choice"|"reason"/);
});

test('页内滚动不写路由或触发草稿保护，外部档案跳转仍保护草稿', () => {
  const page = fixture(); page.click('反馈执行问题'); page.dirty(); const location = page.location(), count = page.navigations.length;
  for (const [label, id] of [['前往当前操作', 'ecn-actions'], ['查看当前资料', 'ecn-content'], ['返回当前资料', 'ecn-content']]) { assert.equal(page.button(label).props.type, 'button'); page.click(label); assert.equal(page.scrolls.at(-1).id, id); assert.deepEqual(page.location(), location); assert.equal(page.navigations.length, count); assert.equal(page.discardDialog().props.open, false); }
  page.navigate('?batch=batch-02', '/__preview/batch-archives'); assert.equal(page.discardDialog().props.open, true); page.cancelDiscard(); assert.equal(page.location().pathname, '/__preview/ecn'); page.navigate('?batch=batch-02', '/__preview/batch-archives'); page.discard(); assert.equal(page.location().pathname, '/__preview/batch-archives'); assert.equal(page.unload(), false);
});

test('导出为当前已保存 ECN 内容与真实文件名，不混入其他变更或未保存填写', async () => {
  const page = fixture(); page.click('确认已阅与适用范围'); await page.save(); page.click('导出变更记录'); assert.equal(page.downloads[0].download, `${current(page).code}-变更记录-演示.csv`); const csv = await page.blobs[0].text(); assert.match(csv, /已核对指定新版与保留旧版范围/); assert.match(csv, /legacy-stock|旧库存/); assert.doesNotMatch(csv, /ECN-202608-011/); assert.deepEqual(page.revoked, ['blob:archive-1']);
  page.click('反馈执行问题'); page.dirty(); page.failExport(); page.click('导出变更记录'); assert.match(page.text(), /导出失败/); assert.equal(page.unload(), true); page.failExport(false); page.click('导出变更记录'); assert.doesNotMatch(await page.blobs[1].text(), /定位工装尚未覆盖新版尺寸/); assert.ok(page.form());
});

test('空态及读取失败恢复已保存记录，重置取消与确认各自正确', async () => {
  const page = fixture(); page.click('确认已阅与适用范围'); await page.save(); const saved = page.state(); page.click('空数据'); assert.equal(page.section(), undefined); page.click('返回演示记录'); assert.equal(page.state(), saved); page.click('读取失败'); assert.equal(page.section(), undefined); page.click('重新读取'); assert.equal(page.state(), saved);
  page.click('重置演示'); const reset = () => page.nodes().find((node) => node.type === 'AlertDialog' && /恢复初始演示变更/.test(normalized(node))); reset().props.onOpenChange(false); page.render(); assert.equal(page.state(), saved); page.click('重置演示'); page.click('重置演示数据'); assert.equal(page.state().version, 1); assert.equal(page.metric('岗位已阅'), '1 / 3');
});

test('生产环境不注册 ECN 预览路由或懒加载', () => {
  const source = ts.createSourceFile('App.tsx', read('App.tsx'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX); let declaration, spread;
  function visit(node) { if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === 'EcnPreviewPage') declaration = node; if (ts.isSpreadElement(node) && node.getText(source).includes('/__preview/ecn')) spread = node; ts.forEachChild(node, visit); }
  visit(source); assert.ok(declaration); assert.ok(spread); const fragment = `const ${declaration.getText(source)}; export const routes = [${spread.getText(source)}];`.replaceAll('import.meta.env.DEV', '__DEV__');
  for (const development of [false, true]) { const exports = {}, loads = []; new Function('exports', 'require', '__DEV__', 'lazyNamed', 'lazyWrap', compile(fragment))(exports, () => ({ jsx, jsxs: jsx }), development, (loader, name) => { loads.push(loader); return name; }, (element) => element); assert.equal(loads.length, development ? 1 : 0); assert.deepEqual(exports.routes.map((route) => route.path), development ? ['/__preview/ecn'] : []); }
});
