import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

const read = (name) => readFileSync(new URL(`../src/app/${name}`, import.meta.url), 'utf8');
const base = 'production/field-tasks/';
const compile = (source) => ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
const jsx = (type, props, key) => ({ type, props: props ?? {}, key });
const primitives = new Proxy({}, { get: (_, key) => key });
const translate = (value, params = {}) => value.replace(/\{(\w+)\}/g, (match, key) => params[key] ?? match);
class FixedDate extends Date { constructor(...args) { super(...(args.length ? args : ['2026-09-11T04:00:00.000Z'])); } static now() { return Date.parse('2026-09-11T04:00:00.000Z'); } }
const noExternal = () => assert.fail('现场预览不得访问正式接口或持久化存储');
const noStorage = new Proxy({}, { get: noExternal, set: noExternal });
function evaluate(code, dependencies = {}, env = {}) {
  const exports = {};
  new Function('exports', 'require', 'window', 'URL', 'fetch', 'localStorage', 'sessionStorage', 'indexedDB', 'Date', code)(exports, (name) => {
    if (/\/ui\/(?:button|input|native-select|textarea|checkbox|radio-group|slider)$/.test(name)) return { Button: "Button", Input: "Input", NativeSelect: "NativeSelect", Textarea: "Textarea", Checkbox: "Checkbox", RadioGroup: "RadioGroup", RadioGroupItem: "RadioGroupItem", Slider: "Slider" };

    assert.ok(Object.hasOwn(dependencies, name), `未审查的依赖 ${name}`); return dependencies[name];
  }, env.window ?? {}, env.URL ?? URL, noExternal, noStorage, noStorage, noStorage, FixedDate);
  return exports;
}
const types = evaluate(compile(read(`${base}fieldTypes.ts`)));
const model = evaluate(compile(read(`${base}fieldModel.ts`)));
const pageCode = compile(read(`${base}FieldPreviewPage.tsx`));
const shared = {
  'react/jsx-runtime': { jsx, jsxs: jsx, Fragment: 'Fragment' }, 'lucide-react': primitives,
  '../../lib/i18n': { useI18n: () => ({ t: translate }), i18nLocale: () => 'zh-CN' },
  '../../components/ui/utils': { cn: (...values) => values.filter(Boolean).join(' ') },
  './fieldModel': model, './fieldTypes': types,
};
const sections = evaluate(compile(read(`${base}FieldSections.tsx`)), { ...shared, '../../components/ui/button': primitives, './field-sections.css': {} });
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
  let cursor = 0, tree, predicate, pending, location = { pathname: '/__preview/field-tasks', search: initialSearch }, exportFails = false;
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
    './FieldSections': { FieldSections: 'FieldSections' }, './FieldActionForm': { FieldActionForm: 'FieldActionForm' },
    '../../order-processing/horizon.css': {}, './field-preview.css': {},
  };
  for (const name of ['alert-dialog', "button", "input", 'label', "select", 'sheet', 'tabs']) dependencies[`../../components/ui/${name}`] = primitives;
  const exports = evaluate(pageCode, dependencies, { window: {
    addEventListener: (name, handler) => listeners.set(name, handler), removeEventListener: (name, handler) => { if (listeners.get(name) === handler) listeners.delete(name); },
    document: { createElement(name) { assert.equal(name, 'a'); const link = { click() { downloads.push({ href: link.href, download: link.download }); }, remove() {} }; return link; }, body: { appendChild() {} }, getElementById(id) { assert.ok(nodes(tree).some((node) => node.props.id === id), `滚动目标 ${id} 存在`); return { scrollIntoView(options) { scrolls.push({ id, options }); } }; } },
    matchMedia: () => ({ matches: mobile }), setTimeout(callback) { callback(); }, requestAnimationFrame(callback) { callback(); },
  }, URL: { createObjectURL(blob) { if (exportFails) throw new Error('download unavailable'); blobs.push(blob); return `blob:field-${blobs.length}`; }, revokeObjectURL(url) { revoked.push(url); } } });
  const view = {
    render() { cursor = 0; tree = exports.FieldPreviewPage(); while (effects.length) effects.shift()(); return tree; },
    nodes: () => nodes(tree), text: () => normalized(tree), byType: (type) => nodes(tree).find((node) => node.type === type), byId: (id) => nodes(tree).find((node) => node.props.id === id),
    section: () => view.byType('FieldSections'), form: () => view.byType('FieldActionForm'), state: () => slots.find((value) => value?.tasks && value?.reports && value?.issues),
    content() { return view.section() ? sections.FieldSections(view.section().props) : null; }, contentText() { return normalized(view.content()); },
    sheet: (title) => view.nodes().find((node) => node.type === 'Sheet' && (!title || normalized(node).includes(title))), params: () => new URLSearchParams(location.search), location: () => ({ ...location }), downloads, blobs, revoked, navigations, scrolls,
    button(label) { return view.nodes().find((node) => ['Button', 'AlertDialogAction', 'AlertDialogCancel'].includes(node.type) && (node.props['aria-label'] === label || normalized(node) === label)); },
    click(label) { const node = view.button(label); assert.ok(node, `${label} exists`); assert.equal(Boolean(node.props.disabled), false, `${label} enabled`); node.props.onClick(); return view.render(); },
    input(id, value) { const node = view.byId(id); assert.ok(node, id); node.props.onChange({ target: { value } }); return view.render(); },
    select(id, value) { const node = view.nodes().find((node) => node.type === 'Select' && nodes(node).some((child) => child.props.id === id)); assert.ok(node, id); node.props.onValueChange(value); return view.render(); },
    tab(value) { view.byType('Tabs').props.onValueChange(value); return view.render(); },
    action(context) { view.section().props.onAction(context); return view.render(); },
    dirty(value = true) { view.form().props.onDirtyChange(value); return view.render(); },
    discardDialog: () => view.nodes().find((node) => node.type === 'AlertDialog' && /放弃尚未保存/.test(normalized(node))),
    exitDialog: () => view.nodes().find((node) => node.type === 'AlertDialog' && /离开当前现场任务/.test(normalized(node))),
    cancelDiscard() { view.discardDialog().props.onOpenChange(false); return view.render(); },
    discard() { view.click('放弃并继续'); return view.render(); },
    cancelExit() { nodes(view.exitDialog()).find((node) => node.type === 'AlertDialogCancel').props.onClick(); return view.render(); },
    exit() { view.click('放弃并离开'); return view.render(); },
    failNext() { view.nodes().find((node) => node.type === "Checkbox").props.onCheckedChange(true); return view.render(); },
    failExport(value = true) { exportFails = value; },
    inputAction(patch = {}) {
      const props = view.form().props, ctx = props.context;
      const common = { kind: ctx.kind, actorId: props.actorId, taskId: ctx.taskId };
      return { ...common, ...({ accept: { reviewed: true }, sign: { issueId: ctx.issueId ?? 'issue-shell-pending', reviewed: true }, report: { date: '2026-09-11', actual: 10, good: 8, bad: 2, note: '现场核对本次完成 10 件，其中 2 件待分析' }, defect: { reportId: ctx.reportId ?? 'report-seed', quantity: 2, phenomenon: '装配干涉', description: '两件独立实物，补充现象，不增加报工不良', issueId: 'issue-main-signed', photos: [] }, return: { issueId: ctx.issueId ?? 'issue-main-signed', quantity: 5, reason: '现场已确认未耗用余料，申请退回', reviewed: true } }[ctx.kind]), ...patch };
    },
    async save(patch = {}) { try { await view.form().props.onSubmit(view.inputAction(patch)); } finally { view.render(); } },
    navigate(search, pathname = location.pathname) { navigate({ pathname, search }); return view.render(); },
    unload() { const event = { prevented: false, preventDefault() { this.prevented = true; } }; listeners.get('beforeunload')?.(event); return event.prevented; },
    metric(label) { const section = view.nodes().find((node) => node.type === 'dl' && node.props.className === 'ft-numbers'); const pair = nodes(section).find((node) => node.type === 'div' && normalized(node.props.children?.[0]) === label); return normalized(pair?.props.children?.[1]); },
  };
  view.render(); return view;
}
const currentTask = (page) => page.state().tasks.find((item) => item.id === page.section()?.props.taskId);
const role = (page, id) => page.select('field-actor', id);
function clickSection(page, label) {
  const node = nodes(page.content()).find((node) => ['Button'].includes(node.type) && (node.props['aria-label'] === label || normalized(node) === label));
  assert.ok(node, label); assert.equal(Boolean(node.props.disabled), false); node.props.onClick(); page.render();
}
const photoData = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl1cAAAAASUVORK5CYII=';
const photo = { id: 'photo-local', name: '本地现场照片.png', type: 'image/png', size: Buffer.from(photoData, 'base64').length, dataUrl: `data:image/png;base64,${photoData}` };

test('默认四视图展示实际40/合格36/不良4，未登记2不重复加总', () => {
  const page = fixture(); assert.equal(currentTask(page).id, 'task-active'); assert.equal(page.nodes().filter((node) => node.type === 'TabsTrigger').length, 4);
  for (const [label, expected] of [['计划数量','60 件'],['累计报工','40 件'],['现场自检合格','36 件'],['现场不良','4 件'],['尚未报工','20 件']]) assert.equal(page.metric(label), expected);
  assert.match(page.contentText(), /REPORT-0911-001.*实际 40 件 合格 36 件 不良 4 件.*2 件.*尚未登记现象/);
  assert.doesNotMatch(page.contentText(), /REPORT-0907-002/); assert.match(page.contentText(), /不良登记补充现象，不再次增加不良数量/);
});

test('本线线长仅看到本线，主管跨线可操作，查看岗位无写入口', () => {
  const page = fixture(); const options = () => nodes(page.nodes().find((node) => node.type === 'Select' && nodes(node).some((child) => child.props.id === 'field-task'))).filter((node) => node.type === 'SelectItem').map((node) => node.props.value);
  assert.deepEqual(options(), ['task-active','task-closed','task-doc-pending']); role(page, 'line-b-owner'); assert.deepEqual(options(), ['task-pending']); assert.equal(page.section().props.readOnly, false); assert.ok(page.button('接收派工'));
  role(page, 'supervisor-a'); assert.equal(options().length, 4); page.select('field-task', 'task-pending'); assert.equal(page.section().props.readOnly, false);
  role(page, 'viewer-a'); assert.equal(options().length, 4); assert.equal(page.section().props.readOnly, true); assert.equal(page.button('提交报工'), undefined); assert.equal(page.button('接收派工'), undefined);
  page.tab('materials'); assert.equal(nodes(page.content()).filter((node) => node.type === 'Button').length, 0); page.action({ kind: 'report', taskId: currentTask(page).id }); assert.equal(page.form(), undefined);
});

test('状态与查询筛选真实任务，未知结果可清除，不展示旧任务操作', () => {
  const page = fixture(); page.select('field-status','pending'); assert.equal(currentTask(page).id, 'task-doc-pending'); page.input('field-query','B-FG-0910'); assert.equal(currentTask(page).id, 'task-doc-pending');
  page.input('field-query','绝不存在'); assert.equal(page.section(), undefined); assert.equal(page.button('接收派工'), undefined); assert.equal(page.button('导出当前任务').props.disabled, true); page.click('清除筛选'); assert.equal(currentTask(page).id, 'task-active');
  page.input('field-query','DISPATCH-0907'); assert.equal(currentTask(page).id,'task-closed'); assert.equal(page.section().props.readOnly,true);
});

test('未知任务参数安全空态，未知分类回报工，恢复不冒充任务匹配', () => {
  const page = fixture('?task=missing&tab=wrong'); assert.equal(page.section(),undefined); assert.equal(page.form(),undefined); page.click('清除筛选'); assert.equal(currentTask(page).id,'task-active'); assert.equal(page.section().props.view,'reports'); assert.equal(page.params().get('task'),null);
  const crossLine = fixture('?task=task-pending'); assert.equal(crossLine.section(),undefined); role(crossLine,'line-b-owner'); assert.equal(currentTask(crossLine).id,'task-pending');
});

test('根表单回调提交报工只增加该任务实绩，不改变派工量和已登记不良', async () => {
  const page=fixture(), before=structuredClone(page.state()); page.click('提交报工'); page.dirty(); await page.save();
  assert.equal(page.metric('累计报工'),'50 件'); assert.equal(page.metric('现场自检合格'),'44 件'); assert.equal(page.metric('现场不良'),'6 件'); assert.equal(page.metric('尚未报工'),'10 件');
  assert.deepEqual(page.state().tasks,before.tasks); assert.deepEqual(page.state().issues,before.issues); assert.deepEqual(page.state().defects,before.defects); assert.equal(page.state().reports.length,before.reports.length+1); assert.equal(page.form(),undefined); assert.equal(page.unload(),false);
  assert.match(page.contentText(),/本次|本任务/); assert.equal(model.getFieldProgress(page.state(),'task-active').unregisteredBad,4);
});

test('接收派工通过根回调产生人员时间，仅解锁当前任务，不产生报工或领料', async () => {
  const page=fixture(); role(page,'line-b-owner'); const before=structuredClone(page.state()); page.click('接收派工'); await page.save();
  assert.equal(currentTask(page).acceptedBy,'line-b-owner'); assert.ok(currentTask(page).acceptedAt); assert.equal(page.params().get('tab'),'history'); assert.match(page.contentText(),/接收派工.*B 线线长/); assert.deepEqual(page.state().reports,before.reports); assert.deepEqual(page.state().issues,before.issues); assert.ok(page.button('提交报工'));
});

test('待接收筛选下接收B线任务后仍定位该任务，可继续签收和报工', async () => {
  const page=fixture(); role(page,'line-b-owner'); page.select('field-status','pending'); assert.equal(currentTask(page).id,'task-pending'); page.click('接收派工'); await page.save();
  assert.equal(currentTask(page).id,'task-pending'); assert.equal(page.params().get('task'),'task-pending'); assert.equal(page.section().props.view,'history');
  const status=page.nodes().find((node)=>node.type==='Select'&&nodes(node).some((child)=>child.props.id==='field-status')); assert.equal(status.props.value,'all');
  page.click('签收领料'); assert.equal(page.form().props.context.taskId,'task-pending'); await page.save({issueId:'issue-b-pending'}); assert.equal(currentTask(page).id,'task-pending'); assert.ok(page.state().issues.find((item)=>item.id==='issue-b-pending').signedAt);
  page.click('提交报工'); await page.save({actual:5,good:5,bad:0}); assert.equal(currentTask(page).id,'task-pending'); assert.equal(page.metric('累计报工'),'5 件'); assert.equal(page.metric('尚未报工'),'35 件');
});

test('真实领料行固定原单签收，缺来料码保留，原发料量和报工不改变', async () => {
  const page=fixture(); page.tab('materials'); assert.match(page.contentText(),/来料批次缺码.*待补齐/); clickSection(page,'签收领料 ISS-0911-002'); assert.equal(page.form().props.context.issueId,'issue-shell-pending'); const before=structuredClone(page.state()); await page.save();
  const issue=page.state().issues.find((item)=>item.id==='issue-shell-pending'); assert.ok(issue.signedAt); assert.equal(issue.signedBy,'line-a-owner'); assert.equal(issue.lotCode,null); assert.equal(issue.quantity,20); assert.deepEqual(page.state().reports,before.reports); assert.equal(model.getReturnable(page.state(),issue.id),20); assert.match(page.contentText(),/签收只确认生产接收，不再次扣仓库/);
});

test('真实报工行登记不良固定reportId，2件补齐原池，照片可从真实记录打开', async () => {
  const page=fixture(); clickSection(page,'登记不良 REPORT-0911-001'); assert.equal(page.form().props.context.reportId,'report-seed'); const before=structuredClone(page.state().reports); await page.save({photos:[photo]});
  assert.equal(page.params().get('tab'),'defects'); assert.deepEqual(page.state().reports,before); assert.equal(page.metric('现场不良'),'4 件'); assert.equal(model.getReportUnregistered(page.state(),'report-seed'),0); assert.match(page.contentText(),/原报工单 REPORT-0911-001.*原领料单 ISS-0911-001.*PCB-260910-D/); assert.match(page.contentText(),/尚未派发质量任务/);
  clickSection(page,`查看照片 ${photo.name}`); assert.equal(page.sheet('现场照片').props.open,true); assert.ok(nodes(page.sheet('现场照片')).some((node)=>node.type==='img'&&node.props.src===photo.dataUrl)); page.sheet('现场照片').props.onOpenChange(false); page.render(); assert.equal(page.sheet('现场照片').props.open,false);
});

test('退料申请以原已签收单为来源，只减少申请上限，不改签收或报工量', async () => {
  const page=fixture(); page.tab('materials'); clickSection(page,'申请退料 ISS-0911-001'); assert.equal(page.form().props.context.issueId,'issue-main-signed'); const before=structuredClone(page.state()); await page.save({quantity:5.25});
  assert.equal(page.state().returns.at(-1).quantity,5.25); assert.equal(page.state().returns.at(-1).status,'requested'); assert.equal(model.getReturnable(page.state(),'issue-main-signed'),34.75); assert.deepEqual(page.state().issues,before.issues); assert.deepEqual(page.state().reports,before.reports); assert.match(page.contentText(),/已申请 5.25 块.*剩余申请上限 34.75 块/); assert.match(page.contentText(),/待仓库处理.*未扣签收量，未加仓库量/);
});

test('保存草稿保留报工表单供继续填写，不增加报工；正式提交后删除个人草稿', async () => {
  const page=fixture(); page.click('提交报工'); page.dirty(); const draft={date:'2026-09-11',actual:'10',good:'8',bad:'2',note:'待核对的报工草稿'}; const before=structuredClone(page.state().reports); await page.save({kind:'save-draft',draft});
  assert.ok(page.form()); assert.equal(page.form().props.context.kind,'report'); assert.deepEqual(page.form().props.state.drafts['line-a-owner:task-active'],draft); assert.deepEqual(page.state().reports,before); assert.equal(page.metric('累计报工'),'40 件'); assert.equal(page.unload(),false);
  page.form().props.onCancel(); page.render(); assert.match(page.text(),/有已保存报工草稿/); page.click('提交报工'); await page.save(); assert.equal(page.state().drafts['line-a-owner:task-active'],undefined); assert.equal(page.metric('累计报工'),'50 件');
});

test('固定来源、操作种类、任务和人员篡改均被根回调拒绝，保留表单和状态', async () => {
  const page=fixture(); page.tab('materials'); clickSection(page,'签收领料 ISS-0911-002'); const before=page.state();
  for(const patch of [{issueId:'issue-main-signed'},{taskId:'task-pending'},{actorId:'supervisor-a'},{kind:'report',date:'2026-09-11',actual:1,good:1,bad:0,note:''}]) await assert.rejects(page.save(patch),/不一致/);
  assert.equal(page.state(),before); assert.ok(page.form()); page.form().props.onCancel(); page.render(); page.tab('reports'); clickSection(page,'登记不良 REPORT-0911-001'); await assert.rejects(page.save({reportId:'report-closed'}),/不一致/); assert.equal(page.state(),before);
});

test('取消重开同动作、已保存和切换操作人的旧回调均失效', async () => {
  const page=fixture(); page.click('提交报工'); const old=page.form().props.onSubmit, input=page.inputAction(); page.form().props.onCancel(); page.render(); page.click('提交报工'); await assert.rejects(old(input),/已变化/); assert.equal(page.metric('累计报工'),'40 件');
  const saved=page.form().props.onSubmit; await saved(page.inputAction()); page.render(); const after=page.state(); await assert.rejects(saved(input),/已变化/); assert.equal(page.state(),after);
  page.click('提交报工'); const switched=page.form().props.onSubmit, switchedInput=page.inputAction(); role(page,'supervisor-a'); await assert.rejects(switched(switchedInput),/已变化/); assert.equal(page.state(),after);
});

test('数量超额、未发布SIP与未来报工日期失败，状态和表单都保留', async () => {
  const page=fixture(); page.click('提交报工'); const before=page.state(); await assert.rejects(page.save({actual:21,good:21,bad:0}),/最多可报/); await assert.rejects(page.save({date:'2026-09-12'}),/不能晚于今天/); assert.equal(page.state(),before); assert.ok(page.form()); page.form().props.onCancel(); page.render();
  clickSection(page,'登记不良 REPORT-0911-001'); await assert.rejects(page.save({quantity:3}),/不良|登记/); assert.equal(page.state(),before); page.form().props.onCancel(); page.render(); page.select('field-task','task-doc-pending'); page.click('接收派工'); await assert.rejects(page.save(),/SIP.*尚未发布/); assert.equal(page.state(),before); assert.ok(page.form());
});

test('未保存表单拦截分类与筛选切换，取消留在原上下文，确认才导航', () => {
  const page=fixture(); page.click('提交报工'); page.dirty(); assert.equal(page.unload(),true); const location=page.location(); page.tab('materials'); assert.equal(page.discardDialog().props.open,true); assert.deepEqual(page.location(),location); assert.equal(page.section().props.view,'reports'); page.cancelDiscard(); assert.ok(page.form());
  page.input('field-query','TASK-0907'); assert.equal(page.byId('field-query').props.value,''); page.cancelDiscard(); page.tab('materials'); page.discard(); assert.equal(page.params().get('tab'),'materials'); assert.equal(page.form(),undefined); assert.equal(page.unload(),false);
  page.click('提交报工'); page.dirty(); const target={value:'TASK-0907'}; page.byId('field-query').props.onChange({target}); page.render(); target.value='旧DOM值已变化'; page.discard(); assert.equal(page.byId('field-query').props.value,'TASK-0907'); assert.equal(currentTask(page).id,'task-closed');
});

test('路由离开受草稿保护，三个区域按钮只滚动不改URL不触发保护', () => {
  const page=fixture('',true); page.click('提交报工'); page.dirty(); page.navigations.length=0; page.scrolls.length=0; const location=page.location();
  for(const label of ['查看任务记录','前往现场操作','返回任务记录']) page.click(label); assert.deepEqual(page.location(),location); assert.equal(page.navigations.length,0); assert.deepEqual(page.scrolls.map((item)=>item.id),['field-records','field-actions','field-records']); assert.equal(page.discardDialog().props.open,false); assert.equal(page.unload(),true);
  page.navigate('?ecn=ecn-01','/__preview/ecn'); assert.equal(page.exitDialog().props.open,true); assert.deepEqual(page.location(),location); page.cancelExit(); assert.ok(page.form()); page.navigate('','/__preview/production-planning'); page.exit(); assert.equal(page.location().pathname,'/__preview/production-planning'); assert.equal(page.unload(),false);
});

test('保存失败保留同一表单、草稿状态和数量，重试只记一次', async () => {
  const page=fixture(); page.click('提交报工'); page.dirty(); page.failNext(); const before=page.state(), context=page.form().props.context, key=page.form().key; await assert.rejects(page.save(),/保存失败.*保留/); assert.equal(page.state(),before); assert.deepEqual(page.form().props.context,context); assert.equal(page.form().key,key); assert.equal(page.unload(),true); await page.save(); assert.equal(page.metric('累计报工'),'50 件'); assert.equal(page.state().reports.length,before.reports.length+1); assert.equal(page.form(),undefined);
});

test('资料摘要与规划ECN链接真实可达，只读仍能查看', () => {
  const page=fixture(); role(page,'viewer-a'); const sourceButton=page.nodes().find((node)=>node.type==="Button"&&normalized(node)==='SOP-CONTROL · D'); assert.ok(sourceButton); sourceButton.props.onClick(); page.render(); assert.equal(page.sheet('现场作业资料摘要').props.open,true); assert.match(normalized(page.sheet('现场作业资料摘要')),/原文件尚未接入.*SOP-CONTROL.*D.*现场执行摘要/);
  assert.ok(page.nodes().some((node)=>node.type==='Link'&&node.props.to==='/__preview/ecn?ecn=ecn-01')); assert.ok(page.nodes().some((node)=>node.type==='Link'&&node.props.to==='/__preview/production-planning?month=2026-09&batch=batch-new')); page.sheet('现场作业资料摘要').props.onOpenChange(false); page.render(); assert.equal(page.sheet('现场作业资料摘要').props.open,false);
});

test('导出实际当前任务CSV，只读可用，失败保留填写且可重试', async () => {
  const page=fixture(); role(page,'viewer-a'); page.click('导出当前任务'); assert.equal(page.downloads[0].download,'TASK-0911-001-现场记录.csv'); const csv=await page.blobs[0].text(); assert.match(csv,/REPORT-0911-001/); assert.match(csv,/DEFECT-0911-001/); assert.doesNotMatch(csv,/REPORT-0907-002|TASK-0911-002/); assert.deepEqual(page.revoked,['blob:field-1']);
  role(page,'line-a-owner'); page.click('提交报工'); page.dirty(); page.failExport(); page.click('导出当前任务'); assert.match(page.text(),/导出未完成/); assert.equal(page.unload(),true); assert.ok(page.form()); page.failExport(false); page.click('导出当前任务'); assert.equal(await page.blobs[1].text(),csv); assert.ok(page.form());
});

test('空态与读取失败能恢复已有记录，重置必须确认并可取消', async () => {
  const page=fixture(); page.click('提交报工'); await page.save(); const saved=page.state(); page.click('空数据'); assert.equal(page.section(),undefined); page.click('清除筛选'); assert.equal(page.state(),saved); page.click('读取失败'); assert.equal(page.section(),undefined); page.click('重试读取'); assert.equal(page.state(),saved);
  const reset=()=>page.nodes().find((node)=>node.type==='AlertDialog'&&normalized(node).includes('重置现场演示')); page.click('重置演示'); assert.equal(reset().props.open,true); reset().props.onOpenChange(false); page.render(); assert.equal(page.state(),saved); page.click('重置演示'); page.click('确认重置'); assert.equal(page.state().version,1); assert.equal(page.metric('累计报工'),'40 件');
});

test('关闭任务与只读场景保留历史，真实组件没有行内写动作', () => {
  const page=fixture(); page.select('field-task','task-closed'); assert.equal(page.section().props.readOnly,true); assert.match(page.contentText(),/REPORT-0907-002.*实际 116 台 合格 116 台 不良 0 台/); assert.equal(page.button('提交报工'),undefined); assert.equal(nodes(page.content()).filter((node)=>node.type==='Button').length,0);
  page.click('正常'); page.select('field-task','task-active'); page.click('只读'); assert.equal(page.section().props.readOnly,true); for(const view of ['reports','materials','defects','history']) { page.tab(view); assert.equal(nodes(page.content()).filter((node)=>node.type==='Button').length,0); } assert.match(page.contentText(),/A 线线长/); assert.doesNotMatch(page.contentText(),/"actorId"|"taskId"|"kind"/);
});

test('DEV开关关闭时不注册P02路由也不创建懒加载', () => {
  const source=ts.createSourceFile('App.tsx',read('App.tsx'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX); let declaration,spread;
  function visit(node) { if(ts.isVariableDeclaration(node)&&ts.isIdentifier(node.name)&&node.name.text==='FieldPreviewPage') declaration=node; if(ts.isSpreadElement(node)&&node.getText(source).includes('/__preview/field-tasks')) spread=node; ts.forEachChild(node,visit); }
  visit(source); assert.ok(declaration); assert.ok(spread); const fragment=`const ${declaration.getText(source)}; export const routes = [${spread.getText(source)}];`.replaceAll('import.meta.env.DEV','__DEV__');
  for(const development of [false,true]) { const exports={}, loads=[]; new Function('exports','require','__DEV__','lazyNamed','lazyWrap',compile(fragment))(exports,()=>({jsx,jsxs:jsx}),development,(loader,name)=>{loads.push(loader);return name;},(element)=>element); assert.equal(loads.length,development?1:0); assert.deepEqual(exports.routes.map((route)=>route.path),development?['/__preview/field-tasks']:[]); }
});
