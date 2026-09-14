import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

const read = (name) => readFileSync(new URL(`../src/app/${name}`, import.meta.url), 'utf8');
const base = 'production/planning/';
const compile = (source) => ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
const jsx = (type, props, key) => ({ type, props: props ?? {}, key });
const primitives = new Proxy({}, { get: (_, key) => key });
const translate = (value, params = {}) => value.replace(/\{(\w+)\}/g, (match, key) => params[key] ?? match);
class FixedDate extends Date { constructor(...args) { super(...(args.length ? args : ['2026-09-11T04:00:00.000Z'])); } static now() { return Date.parse('2026-09-11T04:00:00.000Z'); } }
const noExternal = () => assert.fail('计划预览不得访问正式接口或持久化存储');
const noStorage = new Proxy({}, { get: noExternal, set: noExternal });
function evaluate(code, dependencies = {}, env = {}) {
  const exports = {};
  new Function('exports', 'require', 'window', 'URL', 'fetch', 'localStorage', 'sessionStorage', 'indexedDB', 'Date', code)(exports, (name) => {
    assert.ok(Object.hasOwn(dependencies, name), `未审查的依赖 ${name}`); return dependencies[name];
  }, env.window ?? {}, env.URL ?? URL, noExternal, noStorage, noStorage, noStorage, FixedDate);
  return exports;
}
const types = evaluate(compile(read(`${base}planningTypes.ts`)));
const model = evaluate(compile(read(`${base}planningModel.ts`)));
const pageCode = compile(read(`${base}PlanningPreviewPage.tsx`));
const shared = {
  'react/jsx-runtime': { jsx, jsxs: jsx, Fragment: 'Fragment' }, 'lucide-react': primitives,
  '../../lib/i18n': { useI18n: () => ({ t: translate }), i18nLocale: () => 'zh-CN' },
  '../../components/ui/utils': { cn: (...values) => values.filter(Boolean).join(' ') },
  './planningModel': model, './planningTypes': types,
};
const sections = evaluate(compile(read(`${base}PlanningSections.tsx`)), { ...shared, '../../components/ui/button': primitives, './planning-sections.css': {} });
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

function fixture(initialSearch = '', mobile = false) {
  const slots = [], effects = [], listeners = new Map(), downloads = [], blobs = [], revoked = [], navigations = [], scrolls = [];
  let cursor = 0, tree, predicate, pending, location = { pathname: '/__preview/production-planning', search: initialSearch }, exportFails = false;
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
    './PlanningSections': { PlanningSections: 'PlanningSections' }, './PlanningActionForm': { PlanningActionForm: 'PlanningActionForm' },
    '../../order-processing/horizon.css': {}, './planning-preview.css': {},
  };
  for (const name of ['alert-dialog', 'button', 'input', 'label', 'select', 'sheet', 'tabs']) dependencies[`../../components/ui/${name}`] = primitives;
  const exports = evaluate(pageCode, dependencies, { window: {
    addEventListener: (name, handler) => listeners.set(name, handler), removeEventListener: (name, handler) => { if (listeners.get(name) === handler) listeners.delete(name); },
    document: { createElement(name) { assert.equal(name, 'a'); const link = { click() { downloads.push({ href: link.href, download: link.download }); }, remove() {} }; return link; }, body: { appendChild() {} }, getElementById(id) { assert.ok(nodes(tree).some((node) => node.props.id === id), `滚动目标 ${id} 存在`); return { scrollIntoView(options) { scrolls.push({ id, options }); } }; } },
    matchMedia: () => ({ matches: mobile }), setTimeout(callback) { callback(); }, requestAnimationFrame(callback) { callback(); },
  }, URL: { createObjectURL(blob) { if (exportFails) throw new Error('download unavailable'); blobs.push(blob); return `blob:planning-${blobs.length}`; }, revokeObjectURL(url) { revoked.push(url); } } });
  const view = {
    render() { cursor = 0; tree = exports.PlanningPreviewPage(); while (effects.length) effects.shift()(); return tree; },
    nodes: () => nodes(tree), text: () => normalized(tree), byType: (type) => nodes(tree).find((node) => node.type === type), byId: (id) => nodes(tree).find((node) => node.props.id === id),
    section: () => view.byType('PlanningSections'), form: () => view.byType('PlanningActionForm'), state: () => slots.find((value) => value?.batches && value?.materialRequests),
    content() { return view.section() ? sections.PlanningSections(view.section().props) : null; }, contentText() { return normalized(view.content()); },
    sheet: (title) => view.nodes().find((node) => node.type === 'Sheet' && (!title || normalized(node).includes(title))), params: () => new URLSearchParams(location.search), location: () => ({ ...location }), downloads, blobs, revoked, navigations, scrolls,
    button(label) { return view.nodes().find((node) => ['Button', 'button', 'AlertDialogAction', 'AlertDialogCancel'].includes(node.type) && (node.props['aria-label'] === label || normalized(node) === label)); },
    click(label) { const node = view.button(label); assert.ok(node, `${label} exists`); assert.equal(Boolean(node.props.disabled), false, `${label} enabled`); node.props.onClick(); return view.render(); },
    input(id, value) { const node = view.byId(id); assert.ok(node, id); node.props.onChange({ target: { value } }); return view.render(); },
    range(start, end) { view.input('planning-start', start); view.input('planning-end', end); },
    select(id, value) { const node = view.nodes().find((node) => node.type === 'Select' && nodes(node).some((child) => child.props.id === id)); assert.ok(node, id); node.props.onValueChange(value); return view.render(); },
    tab(value) { view.byType('Tabs').props.onValueChange(value); return view.render(); },
    action(context) { view.section().props.onAction(context); return view.render(); },
    choose(id) { view.section().props.onSelectTask(id); return view.render(); },
    dirty(value = true) { view.form().props.onDirtyChange(value); return view.render(); },
    discardDialog: () => view.nodes().find((node) => node.type === 'AlertDialog' && /放弃尚未保存/.test(normalized(node))),
    exitDialog: () => view.nodes().find((node) => node.type === 'AlertDialog' && /离开当前计划/.test(normalized(node))),
    cancelDiscard() { view.discardDialog().props.onOpenChange(false); return view.render(); },
    discard() { view.click('放弃并继续'); return view.render(); },
    cancelExit() { nodes(view.exitDialog()).find((node) => node.type === 'AlertDialogCancel').props.onClick(); return view.render(); },
    exit() { view.click('放弃并离开'); return view.render(); },
    failNext() { view.nodes().find((node) => node.type === 'input' && node.props.type === 'checkbox').props.onChange({ target: { checked: true } }); return view.render(); },
    failExport(value = true) { exportFails = value; },
    inputAction(patch = {}) {
      const props = view.form().props, ctx = props.context, task = view.state().tasks.find((item) => item.id === ctx.taskId), batch = view.state().batches.find((item) => item.id === ctx.batchId);
      const common = { kind: ctx.kind, actorId: props.actorId };
      return { ...common, ...({ create: { batchId: ctx.batchId, operationId: batch.operations[0].id, date: '2026-09-13', lineId: 'line-a', ownerId: 'line-a-owner', quantity: 20, note: '补齐未安排的最后20件' }, adjust: { taskId: task?.id, date: '2026-09-13', lineId: task?.lineId, ownerId: task?.ownerId, quantity: task?.quantity, note: '核对物料可用日期后人工调整', reason: '按已确认物料可用日期调整，保留实际报工' }, dispatch: { taskId: task?.id, reviewed: true, note: '已核对当前组件任务、用料及发布资料' }, cancel: { taskId: task?.id, reason: '尚未派工，取消本段并重新安排' } }[ctx.kind]), ...patch };
    },
    async save(patch = {}) { try { await view.form().props.onSubmit(view.inputAction(patch)); } finally { view.render(); } },
    navigate(search, pathname = location.pathname) { navigate({ pathname, search }); return view.render(); },
    unload() { const event = { prevented: false, preventDefault() { this.prevented = true; } }; listeners.get('beforeunload')?.(event); return event.prevented; },
    metric(label) { const section = view.nodes().find((node) => node.type === 'section' && node.props.className === 'pp-month'); const pair = nodes(section).find((node) => node.type === 'div' && normalized(node.props.children?.[0]) === label); return normalized(pair?.props.children?.[1]); },
  };
  view.render(); return view;
}
const currentBatch = (page) => page.state().batches.find((item) => item.id === page.section()?.props.batchId);
const currentTask = (page) => page.state().tasks.find((item) => item.id === page.section()?.props.selectedTaskId);
const role = (page, id) => page.select('planning-actor', id);
const action = (page, kind) => page.action({ kind, batchId: currentBatch(page).id, ...(kind === 'create' ? {} : { taskId: currentTask(page).id }) });
function clickSection(page, label) { const node = nodes(page.content()).find((node) => ['Button', 'button'].includes(node.type) && (node.props['aria-label'] === label || normalized(node) === label)); assert.ok(node, label); node.props.onClick(); page.render(); }

test('默认四视图和组件实际量独立，整机月完工只取216台', () => {
  const page = fixture(); assert.equal(page.nodes().filter((node) => node.type === 'TabsTrigger').length, 4); assert.equal(currentTask(page).id, 'task-active');
  assert.equal(page.metric('本月整机目标'), '1000 台'); assert.equal(page.metric('整机已完工'), '216 台'); assert.equal(page.metric('目标剩余'), '784 台');
  assert.match(page.contentText(), /计划 60 件 合格 36 件 剩余 24 件.*已报工 40 件.*待返工 4 件/); assert.match(page.contentText(), /需求 120 件 已安排 100 件 未安排 20 件/);
});

test('P01列表含每行实际批次和工序单位，跨批次选择更新右侧', () => {
  const page = fixture(); page.range('2026-09-01', '2026-09-20'); assert.match(page.contentText(), /TASK-0906-002.*B-FG-0902/); assert.match(page.contentText(), /TASK-0911-001.*B-FG-0910/);
  clickSection(page, '查看任务 TASK-0911-001'); assert.equal(currentBatch(page).id, 'batch-new'); assert.equal(currentTask(page).id, 'task-active'); assert.equal(page.section().props.readOnly, false);
  clickSection(page, '查看任务 TASK-0907-002'); assert.equal(currentBatch(page).id, 'batch-old'); assert.equal(page.section().props.readOnly, true);
});

test('月份产品产线与搜索过滤实际任务，未知条件没有旧任务假结果', () => {
  const page = fixture(); page.select('planning-line', 'line-b'); assert.deepEqual(page.section().props.tasks.map((task) => task.id), ['task-draft']);
  page.input('planning-query', '不存在的计划'); assert.equal(page.section().props.tasks.length, 0); assert.equal(currentTask(page), undefined); assert.equal(page.button('确认派工'), undefined);
  page.input('planning-query', ''); page.select('planning-product', 'product-in200'); assert.equal(page.section(), undefined); page.input('planning-month', '2026-10'); assert.equal(currentBatch(page).id, 'batch-in200'); assert.equal(currentTask(page).id, 'task-in200'); assert.equal(page.metric('本月整机目标'), '80 台');
});

test('P07固定本批按日展示，空日明确无安排，不混入其他批次', () => {
  const page = fixture(); page.tab('schedule'); assert.equal(page.params().get('batch'), 'batch-new'); assert.match(page.contentText(), /TASK-0911-001/); assert.doesNotMatch(page.contentText(), /TASK-0906-002|TASK-0831-030/);
  assert.match(page.contentText(), /当前筛选下无安排/); page.click('3 天'); assert.equal(page.section().props.dates.length, 3); assert.doesNotMatch(page.contentText(), /TASK-0914-003/); page.click('10 天'); assert.equal(page.section().props.dates.length, 10);
  page.input('planning-end', '2026-09-01'); assert.equal(page.section().props.dates.length, 0); assert.match(page.text(), /结束日期不能早于开始日期/);
});

test('跨月未完任务持续提示且可实际选择，不被本月日期静默丢弃', () => {
  const page = fixture(); assert.match(page.text(), /区间前仍有 1 项未完任务/); assert.doesNotMatch(page.contentText(), /TASK-0831-030/); page.click('同时查看未完任务'); assert.match(page.contentText(), /TASK-0831-030.*B-FG-0830/);
  clickSection(page, '查看任务 TASK-0831-030'); assert.equal(currentTask(page).id, 'task-carry'); assert.equal(currentBatch(page).id, 'batch-carry');
});

test('未知批次可恢复，未知任务不展示旧操作，未知视图安全回到组件清单', () => {
  const page = fixture('?batch=missing'); assert.equal(page.section(), undefined); page.click('返回演示计划'); assert.ok(currentBatch(page));
  const missing = fixture('?task=missing&view=invalid'); assert.equal(currentTask(missing), undefined); assert.equal(missing.button('调整计划'), undefined); assert.equal(missing.button('确认派工'), undefined); assert.match(missing.text(), /未找到指定任务/); assert.equal(missing.section().props.view, 'tasks');
});

test('计划深链接按原任务日期定位，过去的本月任务不被默认十天窗口隐藏', () => {
  const page = fixture('?month=2026-09&batch=batch-old&task=task-old-control&view=tasks');
  assert.equal(currentTask(page)?.id, 'task-old-control'); assert.equal(currentBatch(page)?.id, 'batch-old');
  assert.equal(page.byId('planning-start').props.value, '2026-09-06'); assert.equal(page.byId('planning-end').props.value, '2026-09-15');
  assert.equal(page.section().props.readOnly, true); assert.match(page.contentText(), /TASK-0906-002/);
  page.input('planning-start', '2026-09-11'); assert.equal(page.params().has('task'), false); assert.equal(currentTask(page), undefined);
});

test('历史跨月未完深链接定位月底，省略月份可按有效原任务推导月份', () => {
  for (const search of ['?month=2026-08&batch=batch-carry&task=task-carry', '?task=task-carry']) {
    const page = fixture(search); assert.equal(currentTask(page)?.id, 'task-carry'); assert.equal(currentBatch(page)?.id, 'batch-carry');
    assert.equal(page.byId('planning-month').props.value, '2026-08'); assert.equal(page.byId('planning-start').props.value, '2026-08-31'); assert.equal(page.byId('planning-end').props.value, '2026-08-31');
    assert.deepEqual(page.section().props.dates, ['2026-08-31']);
    page.input('planning-query', 'TASK-0831'); assert.equal(page.params().get('month'), '2026-08'); assert.equal(page.byId('planning-month').props.value, '2026-08'); assert.equal(currentTask(page)?.id, 'task-carry');
  }
});

test('跨产品任务深链接初始化对应产品，页面内同月跳转可重新定位窗口', () => {
  const product = fixture('?month=2026-10&batch=batch-in200&task=task-in200'); assert.equal(currentTask(product)?.id, 'task-in200'); assert.equal(currentBatch(product)?.productId, 'product-in200');
  const page = fixture(); page.navigate('?month=2026-09&batch=batch-old&task=task-old-final'); assert.equal(currentTask(page)?.id, 'task-old-final'); assert.equal(page.byId('planning-start').props.value, '2026-09-07');
});

test('无有效深链接保留默认窗口，未知对象和冲突批次不会借用其他任务', () => {
  for (const search of ['', '?task=missing', '?batch=batch-new&task=task-old-control']) {
    const page = fixture(search); assert.equal(page.byId('planning-start').props.value, '2026-09-11'); assert.equal(page.byId('planning-end').props.value, '2026-09-20');
    if (search) assert.equal(currentTask(page), undefined); else assert.equal(currentTask(page)?.id, 'task-active');
  }
  const conflict = fixture('?month=2026-09&batch=batch-carry&task=task-carry'); assert.equal(currentTask(conflict), undefined); assert.equal(conflict.byId('planning-month').props.value, '2026-09');
});

test('新增组件任务填补未安排数量，不产生派工、用料或实际完工', async () => {
  const page = fixture(), original = structuredClone(page.state()); page.click('新增组件任务'); await page.save();
  assert.equal(currentTask(page).status, 'draft'); assert.equal(currentTask(page).quantity, 20); assert.equal(currentTask(page).reported, 0); assert.equal(model.getOperationTotals(page.state(), 'batch-new', 'control').unplanned, 0);
  assert.deepEqual(page.state().batches, original.batches); assert.deepEqual(page.state().dispatches, original.dispatches); assert.deepEqual(page.state().materialRequests, original.materialRequests); assert.equal(page.metric('整机已完工'), '216 台');
});

test('调整开工任务更新计划和需求版本，历史实际日期产线数量和已发保持原样', async () => {
  const page = fixture(), original = structuredClone(currentTask(page)), issued = page.state().materialRequests[0].lines.map((line) => line.issued); page.click('调整计划'); await page.save({ quantity: 50, lineId: 'line-b', ownerId: 'line-b-owner' });
  assert.equal(currentTask(page).date, '2026-09-13'); assert.equal(currentTask(page).lineId, 'line-b'); for (const field of ['reported', 'qualified', 'rework', 'actualDate', 'actualLineId']) assert.equal(currentTask(page)[field], original[field]);
  assert.deepEqual(page.state().materialRequests[0].lines.map((line) => line.issued), issued); assert.equal(page.state().materialRequests[0].lines[2].quantity, 200); assert.equal(page.state().dispatches[0].quantity, 50);
  page.tab('history'); assert.match(page.contentText(), /调整原因|按已确认物料可用日期调整/); assert.match(page.contentText(), /派工快照.*60 件.*50 件/); assert.match(page.contentText(), /主控板|MAT-PCB-100/); assert.doesNotMatch(page.contentText(), /"taskId"|"materialId"|"quantity"/);
});

test('派工生成可查看的唯一派工及BOM需求，已发与待发按各物料单位展示', async () => {
  const page = fixture(); clickSection(page, '查看任务 TASK-0912-002'); page.click('确认派工'); const callback = page.form().props.onSubmit, input = page.inputAction(); await callback(input); page.render();
  assert.equal(page.section().props.view, 'dispatches'); assert.equal(page.state().dispatches.filter((item) => item.taskId === 'task-draft').length, 1); const request = page.state().materialRequests.find((item) => item.taskId === 'task-draft'); assert.deepEqual(request.lines.map((line) => line.quantity), [40, 40, 160]);
  assert.match(page.contentText(), /本批全部派工/); assert.match(page.contentText(), /本批全部用料需求/); assert.match(page.contentText(), /螺钉.*160 颗.*0 颗.*160 颗/); const saved = page.state(); await assert.rejects(callback(input), /已变化/); page.render(); assert.equal(page.state(), saved);
});

test('取消仅释放未派工计划，保留任务及原因，已发生数量不改变', async () => {
  const page = fixture(); clickSection(page, '查看任务 TASK-0912-002'); page.click('取消未派工任务'); await page.save(); assert.equal(currentTask(page).status, 'cancelled'); assert.equal(page.section().props.view, 'history'); assert.match(page.contentText(), /尚未派工，取消本段并重新安排/); assert.equal(model.getOperationTotals(page.state(), 'batch-new', 'control').planned, 60); assert.equal(page.metric('整机已完工'), '216 台');
});

test('超量、低于实绩或资料未发布的提交失败，当前记录与表单保留', async () => {
  const page = fixture(); page.click('调整计划'); const original = page.state(); await assert.rejects(page.save({ quantity: 39 }), /已报工|已发/); assert.equal(page.state(), original); await assert.rejects(page.save({ quantity: 81 }), /最多还可安排/); assert.equal(page.state(), original); assert.ok(page.form()); page.form().props.onCancel(); page.render();
  page.select('planning-product', 'product-in200'); page.input('planning-month', '2026-10'); page.click('确认派工'); const before = page.state(); await assert.rejects(page.save(), /SIP.*尚未发布/); assert.equal(page.state(), before); assert.ok(page.form());
});

test('只读和线长岗位可选择查看导出，结案批次无写操作', () => {
  for (const mode of ['readonly', 'line', 'closed']) {
    const page = fixture(); if (mode === 'readonly') page.click('只读'); else if (mode === 'line') role(page, 'line-a-owner'); else { page.range('2026-09-01', '2026-09-20'); page.select('planning-batch', 'batch-old'); }
    assert.equal(page.section().props.readOnly, true); assert.equal(page.button('新增组件任务'), undefined); assert.equal(page.button('调整计划'), undefined); assert.equal(page.button('确认派工'), undefined); const original = page.state(); action(page, 'create'); assert.equal(page.form(), undefined); assert.equal(page.state(), original); page.click('导出本批计划'); assert.equal(page.downloads.length, 1);
  }
});

test('作业资料从真实按钮打开准确版本，齐套日期摘要不代替排程承诺', () => {
  const page = fixture(), source = currentBatch(page).operations[0].documents[0]; clickSection(page, `查看资料摘要 ${source.code}`); assert.equal(page.sheet('作业资料摘要').props.open, true); assert.ok(normalized(page.sheet('作业资料摘要')).includes(source.version)); assert.match(normalized(page.sheet('作业资料摘要')), /原文件尚未接入/); assert.equal(nodes(page.sheet('作业资料摘要')).filter((node) => ['img', 'iframe'].includes(node.type)).length, 0);
  page.click('查看齐套依据与日期'); assert.equal(page.sheet('批次物料齐套依据').props.open, true); assert.match(normalized(page.sheet('批次物料齐套依据')), /2026-09-13/); assert.match(normalized(page.sheet('批次物料齐套依据')), /不据此自动承诺/);
  const links = page.nodes().filter((node) => node.type === 'Link').map((node) => node.props.to); assert.ok(links.includes('/__preview/ecn?ecn=ecn-01')); assert.ok(links.includes('/proc-inventory-readiness'));
});

test('保存失败保留填写和离开保护，重试只新增一次事件', async () => {
  const page = fixture(); page.click('调整计划'); page.dirty(); page.failNext(); const original = page.state(), key = page.form().key; await assert.rejects(page.save(), /填写内容已保留/); assert.equal(page.state(), original); assert.equal(page.form().key, key); assert.equal(page.unload(), true); await page.save(); assert.equal(page.state().events.length, 1); assert.equal(page.unload(), false);
});

test('筛选月份产品产线角色日期标签及状态均先保护未保存内容', () => {
  for (const change of [(p) => p.input('planning-month', '2026-10'), (p) => p.select('planning-product', 'product-in200'), (p) => p.select('planning-line', 'line-b'), (p) => p.select('planning-batch', 'batch-old'), (p) => role(p, 'supervisor-a'), (p) => p.input('planning-query', 'TASK'), (p) => p.input('planning-start', '2026-09-12'), (p) => p.tab('history'), (p) => p.click('只读')]) {
    const page = fixture(); page.click('调整计划'); page.dirty(); const key = page.form().key; change(page); assert.equal(page.discardDialog().props.open, true); assert.equal(page.form().key, key); page.cancelDiscard(); assert.equal(page.unload(), true); change(page); page.discard(); assert.equal(page.form(), undefined); assert.equal(page.unload(), false);
  }
});

test('固定任务或批次提交不能串写，切换岗位与取消重开使旧回调失效', async () => {
  const page = fixture(); page.click('调整计划'); const original = page.state(); await assert.rejects(page.save({ taskId: 'task-draft' }), /提交对象/); assert.equal(page.state(), original); const callback = page.form().props.onSubmit, input = page.inputAction(); page.form().props.onCancel(); page.render(); page.click('调整计划'); await assert.rejects(callback(input), /已变化/); page.render(); assert.equal(page.state(), original);
  const roleCallback = page.form().props.onSubmit, roleInput = page.inputAction(); role(page, 'supervisor-a'); await assert.rejects(roleCallback(roleInput), /已变化/); page.render(); page.click('新增组件任务'); await assert.rejects(page.save({ batchId: 'batch-carry' }), /提交对象/); assert.equal(page.state(), original);
});

test('页内跳转只滚动不写路由，手机选择滚向操作区，外部链接离开保护填写', () => {
  const page = fixture(); page.click('调整计划'); page.dirty(); const location = page.location(), count = page.navigations.length;
  for (const [label, id] of [['查看计划资料', 'planning-content'], ['前往当前操作', 'planning-actions'], ['返回计划资料', 'planning-content']]) { page.click(label); assert.equal(page.scrolls.at(-1).id, id); assert.deepEqual(page.location(), location); assert.equal(page.navigations.length, count); assert.equal(page.discardDialog().props.open, false); }
  page.navigate('?ecn=ecn-01', '/__preview/ecn'); assert.equal(page.exitDialog().props.open, true); page.cancelExit(); assert.equal(page.location().pathname, '/__preview/production-planning'); page.navigate('?ecn=ecn-01', '/__preview/ecn'); page.exit(); assert.equal(page.location().pathname, '/__preview/ecn'); assert.equal(page.unload(), false);
  const mobile = fixture('', true); clickSection(mobile, '查看任务 TASK-0912-002'); assert.equal(mobile.scrolls.at(-1).id, 'planning-actions');
});

test('派工与历史按本批全部记录显示，不受当前日期窗口裁去已有来源', async () => {
  const page = fixture(); page.click('调整计划'); await page.save(); page.range('2026-09-16', '2026-09-17'); page.tab('dispatches'); assert.equal(page.section().props.tasks.length, 0); assert.match(page.contentText(), /DISPATCH-0911-001/); assert.match(page.contentText(), /MR-0911-001/); page.tab('history'); assert.match(page.contentText(), /按已确认物料可用日期调整/);
});

test('从本批派工打开日期产线或查询筛选外的任务，定位原计划并清理阻挡条件', () => {
  const selectedValue = (page, id) => page.nodes().find((node) => node.type === 'Select' && nodes(node).some((child) => child.props.id === id)).props.value;
  for (const filter of [(page) => page.range('2026-09-16', '2026-09-17'), (page) => page.select('planning-line', 'line-b'), (page) => page.input('planning-query', '没有匹配的任务'), (page) => { page.range('2026-09-16', '2026-09-17'); page.select('planning-line', 'line-b'); page.input('planning-query', '没有匹配的任务'); }]) {
    const page = fixture(); page.select('planning-batch', 'batch-new'); filter(page); page.tab('dispatches'); assert.equal(page.section().props.tasks.some((task) => task.id === 'task-active'), false);
    const dispatchRow = nodes(page.content()).find((node) => node.type === 'tr' && normalized(node).includes('DISPATCH-0911-001')); assert.ok(dispatchRow); const button = nodes(dispatchRow).find((node) => node.type === 'Button' && node.props['aria-label'] === '查看当前任务 TASK-0911-001'); assert.ok(button);
    const original = page.state(); button.props.onClick(); page.render(); assert.equal(currentTask(page)?.id, 'task-active'); assert.equal(currentBatch(page)?.id, 'batch-new'); assert.ok(page.button('调整计划')); assert.equal(page.section().props.view, 'dispatches');
    assert.equal(page.params().get('month'), '2026-09'); assert.equal(page.byId('planning-start').props.value, '2026-09-11'); assert.equal(page.byId('planning-end').props.value, '2026-09-11'); assert.equal(page.byId('planning-query').props.value, ''); assert.equal(selectedValue(page, 'planning-line'), 'all'); assert.equal(selectedValue(page, 'planning-product'), 'product-in100'); assert.equal(page.state(), original);
  }
  const visible = fixture(); visible.tab('dispatches'); const range = [visible.byId('planning-start').props.value, visible.byId('planning-end').props.value]; clickSection(visible, '查看当前任务 TASK-0911-001'); assert.deepEqual([visible.byId('planning-start').props.value, visible.byId('planning-end').props.value], range);
});

test('打开筛选外派工任务先保护草稿，取消保留全部原条件，确认放弃才定位任务', () => {
  const page = fixture(); page.select('planning-batch', 'batch-new'); page.range('2026-09-16', '2026-09-17'); page.select('planning-line', 'line-b'); page.input('planning-query', '没有匹配的任务'); page.tab('dispatches'); page.click('新增组件任务'); page.dirty();
  const original = { location: page.location(), start: page.byId('planning-start').props.value, end: page.byId('planning-end').props.value, query: page.byId('planning-query').props.value, key: page.form().key, state: page.state() };
  clickSection(page, '查看当前任务 TASK-0911-001'); assert.equal(page.discardDialog().props.open, true); assert.deepEqual(page.location(), original.location); assert.equal(page.form().key, original.key);
  page.cancelDiscard(); assert.equal(currentTask(page), undefined); assert.deepEqual(page.location(), original.location); assert.equal(page.byId('planning-start').props.value, original.start); assert.equal(page.byId('planning-end').props.value, original.end); assert.equal(page.byId('planning-query').props.value, original.query); const lineControl = page.nodes().find((node) => node.type === 'Select' && nodes(node).some((child) => child.props.id === 'planning-line')); assert.equal(lineControl.props.value, 'line-b'); assert.equal(page.form().key, original.key); assert.equal(page.unload(), true); assert.equal(page.state(), original.state);
  clickSection(page, '查看当前任务 TASK-0911-001'); page.discard(); assert.equal(currentTask(page)?.id, 'task-active'); assert.equal(page.byId('planning-start').props.value, '2026-09-11'); assert.equal(page.byId('planning-query').props.value, ''); assert.equal(page.form(), undefined); assert.equal(page.unload(), false); assert.equal(page.state(), original.state);
});

test('CSV导出当前批次全部已保存来源与历史，失败不丢草稿且不含其他批次', async () => {
  const page = fixture(); page.click('调整计划'); await page.save(); page.click('导出本批计划'); assert.equal(page.downloads[0].download, 'B-FG-0910-计划与派工-演示.csv'); const csv = await page.blobs[0].text(); assert.match(csv, /按已确认物料可用日期调整/); assert.match(csv, /TASK-0914-003/); assert.doesNotMatch(csv, /TASK-0907-002/); assert.deepEqual(page.revoked, ['blob:planning-1']);
  page.click('调整计划'); page.dirty(); page.failExport(); page.click('导出本批计划'); assert.match(page.text(), /计划导出失败/); assert.equal(page.unload(), true); page.failExport(false); page.click('导出本批计划'); assert.ok(page.form()); assert.equal(await page.blobs[1].text(), csv);
});

test('空态和读取失败恢复已保存状态，重置需要确认且可取消', async () => {
  const page = fixture(); page.click('调整计划'); await page.save(); const saved = page.state(); page.click('空记录'); assert.equal(page.section(), undefined); page.click('返回演示计划'); assert.equal(page.state(), saved); page.click('读取失败'); assert.equal(page.section(), undefined); page.click('重新读取'); assert.equal(page.state(), saved);
  page.click('重置演示'); const reset = () => page.nodes().find((node) => node.type === 'AlertDialog' && /重置本次演示/.test(normalized(node))); reset().props.onOpenChange(false); page.render(); assert.equal(page.state(), saved); page.click('重置演示'); page.click('确认重置'); assert.equal(page.state().version, 1); assert.equal(page.state().events.length, 0);
});

test('正式构建不注册P01/P07预览路由也不创建懒加载', () => {
  const source = ts.createSourceFile('App.tsx', read('App.tsx'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX); let declaration, spread;
  function visit(node) { if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === 'PlanningPreviewPage') declaration = node; if (ts.isSpreadElement(node) && node.getText(source).includes('/__preview/production-planning')) spread = node; ts.forEachChild(node, visit); }
  visit(source); assert.ok(declaration); assert.ok(spread); const fragment = `const ${declaration.getText(source)}; export const routes = [${spread.getText(source)}];`.replaceAll('import.meta.env.DEV', '__DEV__');
  for (const development of [false, true]) { const exports = {}, loads = []; new Function('exports', 'require', '__DEV__', 'lazyNamed', 'lazyWrap', compile(fragment))(exports, () => ({ jsx, jsxs: jsx }), development, (loader, name) => { loads.push(loader); return name; }, (element) => element); assert.equal(loads.length, development ? 1 : 0); assert.deepEqual(exports.routes.map((route) => route.path), development ? ['/__preview/production-planning'] : []); }
});
