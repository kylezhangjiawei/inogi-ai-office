import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

const read = (name) => readFileSync(new URL(`../src/app/${name}`, import.meta.url), 'utf8');
const base = 'production/inspections/';
const compile = (source) => ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
const jsx = (type, props, key) => ({ type, props: props ?? {}, key });
const primitives = new Proxy({}, { get: (_, key) => key });
const translate = (value, params = {}) => value.replace(/\{(\w+)\}/g, (match, key) => params[key] ?? match);
class FixedDate extends Date { constructor(...args) { super(...(args.length ? args : ['2026-09-11T04:00:00.000Z'])); } static now() { return Date.parse('2026-09-11T04:00:00.000Z'); } }
const noExternal = () => assert.fail('检验预览不得访问正式接口或持久化存储');
const noStorage = new Proxy({}, { get: noExternal, set: noExternal });
function evaluate(code, dependencies = {}, env = {}) {
  const exports = {};
  new Function('exports', 'require', 'window', 'URL', 'fetch', 'localStorage', 'sessionStorage', 'indexedDB', 'Date', code)(exports, (name) => {
    assert.ok(Object.hasOwn(dependencies, name), `未审查的依赖 ${name}`); return dependencies[name];
  }, env.window ?? {}, env.URL ?? URL, noExternal, noStorage, noStorage, noStorage, FixedDate);
  return exports;
}
const types = evaluate(compile(read(`${base}inspectionTypes.ts`)));
const model = evaluate(compile(read(`${base}inspectionModel.ts`)));
const pageCode = compile(read(`${base}InspectionPreviewPage.tsx`));
const shared = {
  'react/jsx-runtime': { jsx, jsxs: jsx, Fragment: 'Fragment' }, 'lucide-react': primitives,
  '../../lib/i18n': { useI18n: () => ({ t: translate }), i18nLocale: () => 'zh-CN' },
  '../../components/ui/utils': { cn: (...values) => values.filter(Boolean).join(' ') },
  './inspectionModel': model, './inspectionTypes': types,
};
const sections = evaluate(compile(read(`${base}InspectionSections.tsx`)), { ...shared, '../../components/ui/button': primitives, './inspection-sections.css': {} });
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
  let cursor = 0, tree, predicate, pending, location = { pathname: '/__preview/production-inspections', search: initialSearch }, exportFails = false;
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
    './InspectionSections': { InspectionSections: 'InspectionSections' }, './InspectionActionForm': { InspectionActionForm: 'InspectionActionForm' },
    '../../order-processing/horizon.css': {}, './inspection-preview.css': {},
  };
  for (const name of ['alert-dialog', 'button', 'input', 'label', 'select', 'sheet', 'tabs']) dependencies[`../../components/ui/${name}`] = primitives;
  const exports = evaluate(pageCode, dependencies, { window: {
    addEventListener: (name, handler) => listeners.set(name, handler), removeEventListener: (name, handler) => { if (listeners.get(name) === handler) listeners.delete(name); },
    document: { createElement(name) { assert.equal(name, 'a'); const link = { click() { downloads.push({ href: link.href, download: link.download }); }, remove() {} }; return link; }, body: { appendChild() {} }, getElementById(id) { assert.ok(nodes(tree).some((node) => node.props.id === id), `滚动目标 ${id} 存在`); return { scrollIntoView(options) { scrolls.push({ id, options }); } }; } },
    matchMedia: () => ({ matches: mobile }), setTimeout(callback) { callback(); }, requestAnimationFrame(callback) { callback(); },
  }, URL: { createObjectURL(blob) { if (exportFails) throw new Error('download unavailable'); blobs.push(blob); return `blob:inspection-${blobs.length}`; }, revokeObjectURL(url) { revoked.push(url); } } });
  const view = {
    render() { cursor = 0; tree = exports.InspectionPreviewPage(); while (effects.length) effects.shift()(); return tree; },
    nodes: () => nodes(tree), text: () => normalized(tree), byType: (type) => nodes(tree).find((node) => node.type === type), byId: (id) => nodes(tree).find((node) => node.props.id === id),
    section: () => view.byType('InspectionSections'), form: () => view.byType('InspectionActionForm'), state: () => slots.find((value) => value?.tasks && value?.records && value?.issues),
    content() { return view.section() ? sections.InspectionSections(view.section().props) : null; }, contentText() { return normalized(view.content()); },
    sheet: (title) => view.nodes().find((node) => node.type === 'Sheet' && (!title || normalized(node).includes(title))), params: () => new URLSearchParams(location.search), location: () => ({ ...location }), downloads, blobs, revoked, navigations, scrolls,
    button(label) { return view.nodes().find((node) => ['Button', 'button', 'AlertDialogAction', 'AlertDialogCancel'].includes(node.type) && (node.props['aria-label'] === label || normalized(node) === label)); },
    click(label) { const node = view.button(label); assert.ok(node, `${label} exists`); assert.equal(Boolean(node.props.disabled), false, `${label} enabled`); node.props.onClick(); return view.render(); },
    input(id, value) { const node = view.byId(id); assert.ok(node, id); node.props.onChange({ target: { value } }); return view.render(); },
    select(id, value) { const node = view.nodes().find((node) => node.type === 'Select' && nodes(node).some((child) => child.props.id === id)); assert.ok(node, id); node.props.onValueChange(value); return view.render(); },
    tab(value) { view.byType('Tabs').props.onValueChange(value); return view.render(); },
    action(context) { view.section().props.onAction(context); return view.render(); },
    dirty(value = true) { view.form().props.onDirtyChange(value); return view.render(); },
    discardDialog: () => view.nodes().find((node) => node.type === 'AlertDialog' && /放弃尚未保存/.test(normalized(node))),
    exitDialog: () => view.nodes().find((node) => node.type === 'AlertDialog' && /离开当前检验任务/.test(normalized(node))),
    cancelDiscard() { view.discardDialog().props.onOpenChange(false); return view.render(); },
    discard() { view.click('放弃并继续'); return view.render(); },
    cancelExit() { nodes(view.exitDialog()).find((node) => node.type === 'AlertDialogCancel').props.onClick(); return view.render(); },
    exit() { view.click('放弃并离开'); return view.render(); },
    failNext() { view.nodes().find((node) => node.type === 'input' && node.props.type === 'checkbox').props.onChange({ target: { checked: true } }); return view.render(); },
    failExport(value = true) { exportFails = value; },
    inputAction(patch = {}) {
      const props=view.form().props, ctx=props.context;
      const common={kind:ctx.kind, actorId:props.actorId, taskId:ctx.taskId, reviewed:true};
      const result={date:'2026-09-11',quantity:2,good:2,bad:0,note:'',evidence:'已按SIP逐项核对并记录原始读数',photos:[]};
      return {...common,...({accept:{},inspect:{...result,quantity:10,good:10},reinspect:{...result,issueId:ctx.issueId??'issue-ready'},transfer:{recordId:ctx.recordId??'record-process',phenomenon:'装配干涉',description:''},release:{quantity:5,basis:'QA已核对质量授权凭据QA-APP-0911，范围为本批前5台',note:''}}[ctx.kind]),...patch};
    },
    async save(patch = {}) { try { await view.form().props.onSubmit(view.inputAction(patch)); } finally { view.render(); } },
    navigate(search, pathname = location.pathname) { navigate({ pathname, search }); return view.render(); },
    unload() { const event = { prevented: false, preventDefault() { this.prevented = true; } }; listeners.get('beforeunload')?.(event); return event.prevented; },
    metric(label) { const section = view.nodes().find((node) => node.type === 'dl' && node.props.className === 'ip-numbers'); const pair = nodes(section).find((node) => node.type === 'div' && normalized(node.props.children?.[0]) === label); return normalized(pair?.props.children?.[1]); },
  };
  view.render(); return view;
}
const currentTask=(page)=>page.state().tasks.find((item)=>item.id===page.section()?.props.taskId);
const progress=(page)=>model.getInspectionProgress(page.state(),currentTask(page).id);
const role=(page,id)=>page.select('inspection-actor',id);
function clickSection(page,label) {const node=nodes(page.content()).find((node)=>['Button','button'].includes(node.type)&&(node.props['aria-label']===label||normalized(node)===label));assert.ok(node,label);assert.equal(Boolean(node.props.disabled),false);node.props.onClick();page.render();}
const photoData='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl1cAAAAASUVORK5CYII=';
const photo={id:'photo-local',name:'原始检验照片.png',type:'image/png',size:Buffer.from(photoData,'base64').length,dataUrl:`data:image/png;base64,${photoData}`};

test('默认首次50/47/3与94%正确，过程检160不混入当前终检',()=>{
  const page=fixture();assert.equal(currentTask(page).id,'task-final');assert.equal(page.nodes().filter((node)=>node.type==='TabsTrigger').length,4);
  for(const [label,value] of [['首次检验','50 台'],['首次合格','47 台'],['首次不合格','3 台'],['一次合格率','94.0%']])assert.equal(page.metric(label),value);
  assert.match(page.contentText(),/QC-0911-001.*初检.*终检.*检验量 50 台 合格 47 台 不良 3 台/);assert.doesNotMatch(page.contentText(),/QC-0911-003|160 件/);assert.equal(progress(page).released,0);assert.equal(progress(page).qualified,47);
});

test('QC与QA按动作分权，查看岗位与只读场景没有写入口',()=>{
  const page=fixture();assert.ok(page.button('登记复验'));assert.equal(page.button('记录 QA 放行'),undefined);role(page,'qa-a');assert.equal(page.section().props.readOnly,false);assert.equal(page.button('登记复验'),undefined);assert.equal(page.button('登记初检'),undefined);assert.equal(page.button('记录 QA 放行').props.disabled,true);
  page.tab('issues');assert.equal(nodes(page.content()).filter((node)=>node.type==='Button').length,0);page.action({kind:'reinspect',taskId:'task-final',issueId:'issue-ready'});assert.equal(page.form(),undefined);
  role(page,'viewer-a');assert.equal(page.section().props.readOnly,true);assert.equal(page.button('记录 QA 放行'),undefined);page.click('只读');assert.equal(page.section().props.readOnly,true);
});

test('切换QA和只读岗位保留当前放行任务、分类及筛选，不重新导航到默认任务',()=>{
  const page=fixture();page.select('inspection-status','active');page.input('inspection-query','IQT-0911');page.select('inspection-task','task-release');page.tab('releases');const location=page.location(),before=page.state();page.navigations.length=0;
  for(const actorId of ['qa-a','viewer-a','qc-a']){
    role(page,actorId);assert.equal(currentTask(page).id,'task-release');assert.equal(page.params().get('task'),'task-release');assert.equal(page.section().props.actorId,actorId);assert.equal(page.section().props.view,'releases');assert.equal(page.byId('inspection-query').props.value,'IQT-0911');assert.equal(page.nodes().find((node)=>node.type==='Select'&&nodes(node).some((child)=>child.props.id==='inspection-status')).props.value,'active');assert.deepEqual(page.location(),location);assert.equal(page.state(),before);
    if(actorId==='qa-a')assert.equal(page.button('记录 QA 放行').props.disabled,false);else assert.equal(page.button('记录 QA 放行'),undefined);
    assert.equal(page.section().props.readOnly,actorId==='viewer-a');
  }
  assert.equal(page.navigations.length,0);
});

test('未保存放行切换岗位可取消保留，放弃后仍留当前任务且旧提交回调失效',async()=>{
  const page=fixture();page.select('inspection-status','active');page.input('inspection-query','IQT-0911');page.select('inspection-task','task-release');page.tab('releases');role(page,'qa-a');page.click('记录 QA 放行');page.dirty();const location=page.location(),before=page.state(),key=page.form().key,submit=page.form().props.onSubmit,input=page.inputAction();
  role(page,'viewer-a');assert.equal(page.discardDialog().props.open,true);assert.equal(page.form().props.actorId,'qa-a');assert.equal(page.form().key,key);assert.equal(currentTask(page).id,'task-release');assert.deepEqual(page.location(),location);page.cancelDiscard();assert.equal(page.form().key,key);assert.equal(page.unload(),true);assert.equal(page.section().props.actorId,'qa-a');assert.equal(page.state(),before);
  role(page,'viewer-a');page.discard();assert.equal(page.form(),undefined);assert.equal(page.section().props.actorId,'viewer-a');assert.equal(page.section().props.readOnly,true);assert.equal(currentTask(page).id,'task-release');assert.equal(page.section().props.view,'releases');assert.equal(page.byId('inspection-query').props.value,'IQT-0911');assert.equal(page.nodes().find((node)=>node.type==='Select'&&nodes(node).some((child)=>child.props.id==='inspection-status')).props.value,'active');assert.deepEqual(page.location(),location);assert.equal(page.unload(),false);await assert.rejects(submit(input),/已变化/);assert.equal(page.state(),before);
  role(page,'qa-a');assert.equal(currentTask(page).id,'task-release');page.click('记录 QA 放行');assert.notEqual(page.form().key,key);await assert.rejects(submit(input),/已变化/);assert.equal(page.state(),before);
});

test('状态与查询筛选真实任务，未知任务或分类可恢复且不冒用旧操作',()=>{
  const page=fixture();page.select('inspection-status','pending');assert.equal(currentTask(page).id,'task-pending');page.input('inspection-query','IQT-0911-005');assert.equal(currentTask(page).id,'task-doc-pending');page.input('inspection-query','无此来源');assert.equal(page.section(),undefined);assert.equal(page.button('接受报检'),undefined);page.click('清除筛选');assert.equal(currentTask(page).id,'task-final');
  const unknown=fixture('?task=missing&tab=invalid');assert.equal(unknown.section(),undefined);assert.equal(unknown.button('导出当前任务').props.disabled,true);unknown.click('清除筛选');assert.equal(unknown.section().props.view,'records');assert.equal(currentTask(unknown).id,'task-final');
});

test('待接收筛选下接受报检保留原任务，能继续初检且不自动转为全部完成',async()=>{
  const page=fixture();page.select('inspection-status','pending');page.click('接受报检');const before=structuredClone(page.state().records);await page.save();assert.equal(currentTask(page).id,'task-pending');assert.equal(page.params().get('task'),'task-pending');assert.equal(page.section().props.view,'history');assert.deepEqual(page.state().records,before);assert.equal(currentTask(page).acceptedBy,'qc-a');
  const status=page.nodes().find((node)=>node.type==='Select'&&nodes(node).some((child)=>child.props.id==='inspection-status'));assert.equal(status.props.value,'all');page.click('登记初检');await page.save({quantity:10,good:8,bad:2});assert.equal(progress(page).initial,10);assert.equal(progress(page).uninspected,10);assert.equal(page.metric('一次合格率'),'80.0%');assert.equal(progress(page).released,0);
});

test('全合格初检可保存，累计初检受报检量约束而非现场不良量',async()=>{
  const page=fixture('?task=task-pending');page.click('接受报检');await page.save();page.click('登记初检');await page.save({quantity:20,good:20,bad:0});assert.equal(page.metric('首次检验'),'20 件');assert.equal(page.metric('首次合格'),'20 件');assert.equal(page.metric('一次合格率'),'100.0%');assert.equal(page.state().records.at(-1).conclusion,'qualified');assert.equal(currentTask(page).quantity,20);assert.equal(page.button('登记初检').props.disabled,true);assert.equal(page.state().issues.some((item)=>item.taskId==='task-pending'),false);
});

test('处置行复验2台通过后累计合格49，首次47/3/94%不变且仍有1台未解决',async()=>{
  const page=fixture();page.tab('issues');assert.match(page.contentText(),/原不良 3 台 已处置可复验 2 台 尚待复验 2 台/);assert.match(page.contentText(),/另有 1 台 尚待处置/);clickSection(page,'登记复验 NCR-0911-001');assert.equal(page.form().props.context.issueId,'issue-ready');const initial=structuredClone(page.state().records.find((item)=>item.id==='record-initial'));await page.save();
  assert.deepEqual(page.state().records.find((item)=>item.id==='record-initial'),initial);assert.equal(progress(page).qualified,49);assert.equal(progress(page).unresolved,1);assert.equal(progress(page).releasable,0);assert.equal(page.metric('一次合格率'),'94.0%');assert.equal(model.getReinspectable(page.state(),'issue-ready'),0);assert.match(page.contentText(),/原检验.*QC-0911-001.*不良单.*NCR-0911-001.*处置依据.*DISP-0911-001/);
  role(page,'qa-a');assert.equal(page.button('记录 QA 放行').props.disabled,true);page.tab('releases');assert.match(page.contentText(),/仍有 1 台 未解决不良/);assert.equal(nodes(page.content()).filter((node)=>node.type==='Button').length,0);
});

test('部分复验失败保留原处置范围，新转处理尚未处置不能立即再次复验',async()=>{
  const page=fixture();page.click('登记复验');await page.save({quantity:2,good:1,bad:1});const retest=page.state().records.at(-1);assert.equal(progress(page).qualified,48);assert.equal(progress(page).unresolved,2);assert.equal(model.getReinspectable(page.state(),'issue-ready'),0);assert.equal(page.metric('首次不合格'),'3 台');
  clickSection(page,`转不良处理 ${retest.code}`);await page.save();const issue=page.state().issues.at(-1);assert.equal(issue.recordId,retest.id);assert.equal(issue.quantity,1);assert.equal(issue.readyQuantity,0);assert.equal(model.getReinspectable(page.state(),issue.id),0);assert.equal(progress(page).unresolved,2);assert.match(page.contentText(),/尚无处置依据/);
  page.action({kind:'reinspect',taskId:'task-final',issueId:issue.id});const before=page.state();await assert.rejects(page.save({quantity:1,good:1,bad:0}),/处置凭据|可复验/);assert.equal(page.state(),before);
});

test('过程检原记录转6件不良，固定来源且不更改154/6或产生复验',async()=>{
  const page=fixture('?task=task-process');page.tab('issues');assert.match(page.contentText(),/QC-0911-003.*6 件/);clickSection(page,'转不良处理 QC-0911-003');assert.equal(page.form().props.context.recordId,'record-process');const before=structuredClone(page.state().records);await page.save();assert.equal(page.state().issues.at(-1).quantity,6);assert.equal(page.state().issues.at(-1).readyQuantity,0);assert.deepEqual(page.state().records,before);assert.equal(page.metric('首次合格'),'154 件');assert.equal(page.metric('首次不合格'),'6 件');assert.equal(page.button('登记复验').props.disabled,true);assert.match(page.contentText(),/待处置/);
});

test('根回调核对固定来源、种类、任务和人员，篡改不写记录',async()=>{
  const page=fixture();page.tab('issues');clickSection(page,'登记复验 NCR-0911-001');const before=page.state();for(const patch of [{issueId:'issue-history'},{taskId:'task-process'},{actorId:'qa-a'},{kind:'inspect'}])await assert.rejects(page.save(patch),/不一致/);assert.equal(page.state(),before);assert.ok(page.form());page.form().props.onCancel();page.render();page.select('inspection-task','task-process');page.tab('issues');clickSection(page,'转不良处理 QC-0911-003');await assert.rejects(page.save({recordId:'record-initial'}),/不一致/);assert.equal(page.state(),before);
});

test('QA分次授权放行5加5且不改初检，额度用完不能重复放行',async()=>{
  const page=fixture();role(page,'qa-a');page.select('inspection-task','task-release');page.tab('releases');assert.match(page.contentText(),/累计检验合格 10 台 已记录放行 0 台 当前可记录放行 10 台/);clickSection(page,'记录 QA 放行 IQT-0911-004');const records=structuredClone(page.state().records);await page.save();assert.equal(progress(page).released,5);assert.equal(progress(page).releasable,5);assert.deepEqual(page.state().records,records);assert.match(page.contentText(),/QA已核对质量授权凭据QA-APP-0911/);
  page.click('记录 QA 放行');await page.save({basis:'QA-APP-0911-02，核对本批剩余5台'});assert.equal(progress(page).released,10);assert.equal(page.state().releases.filter((item)=>item.taskId==='task-release').length,2);assert.equal(page.button('记录 QA 放行').props.disabled,true);assert.match(page.text(),/尚未产生出货记录/);
});

test('过程检无QA放行入口，终检未解决不良或缺授权依据会阻断提交',async()=>{
  const page=fixture();role(page,'qa-a');page.select('inspection-task','task-process');assert.equal(page.button('记录 QA 放行'),undefined);page.tab('releases');assert.match(page.contentText(),/过程检任务.*不在本页记录整机质量放行/);page.action({kind:'release',taskId:'task-process'});assert.equal(page.form(),undefined);
  page.select('inspection-task','task-final');page.action({kind:'release',taskId:'task-final'});const before=page.state();await assert.rejects(page.save(),/未解决不良/);assert.equal(page.state(),before);page.form().props.onCancel();page.render();page.select('inspection-task','task-release');page.click('记录 QA 放行');await assert.rejects(page.save({basis:''}),/授权依据/);await assert.rejects(page.save({quantity:11}),/最多还可放行/);assert.equal(page.state(),before);
});

test('未发布SIP、未来日期或复验超过处置范围均失败并保留输入上下文',async()=>{
  const page=fixture('?task=task-doc-pending');page.click('接受报检');const before=page.state();await assert.rejects(page.save(),/SIP.*尚未发布/);assert.equal(page.state(),before);assert.ok(page.form());page.form().props.onCancel();page.render();page.select('inspection-task','task-final');page.click('登记复验');await assert.rejects(page.save({quantity:3,good:3}),/仅剩 2/);await assert.rejects(page.save({date:'2026-09-12'}),/不能晚于今天/);assert.equal(page.state(),before);
});

test('取消重开、成功保存和换角色后，旧表单回调不能写入',async()=>{
  const page=fixture();page.click('登记复验');const stale=page.form().props.onSubmit,input=page.inputAction();page.form().props.onCancel();page.render();page.click('登记复验');await assert.rejects(stale(input),/已变化/);const callback=page.form().props.onSubmit;await callback(page.inputAction());page.render();const saved=page.state();await assert.rejects(callback(input),/已变化/);assert.equal(page.state(),saved);
  page.select('inspection-task','task-process');page.click('转不良处理');const switched=page.form().props.onSubmit,switchedInput=page.inputAction();role(page,'qa-a');await assert.rejects(switched(switchedInput),/已变化/);assert.equal(page.state(),saved);
});

test('草稿保护拦截任务和分类，取消保留原范围，延迟筛选使用当时输入值',()=>{
  const page=fixture();page.click('登记复验');page.dirty();const location=page.location();page.select('inspection-task','task-process');assert.equal(page.discardDialog().props.open,true);assert.equal(currentTask(page).id,'task-final');assert.deepEqual(page.location(),location);page.cancelDiscard();page.tab('issues');assert.equal(page.discardDialog().props.open,true);page.cancelDiscard();assert.ok(page.form());
  const target={value:'IQT-0911-003'};page.byId('inspection-query').props.onChange({target});page.render();target.value='变动后的DOM值';page.discard();assert.equal(page.byId('inspection-query').props.value,'IQT-0911-003');assert.equal(currentTask(page).id,'task-process');assert.equal(page.form(),undefined);assert.equal(page.unload(),false);
});

test('区域跳转只滚动，路由离开受未保存保护，返回继续原填写',()=>{
  const page=fixture('',true);page.click('登记复验');page.dirty();page.navigations.length=0;page.scrolls.length=0;const location=page.location();for(const label of ['查看检验记录','前往检验操作','返回检验记录'])page.click(label);assert.deepEqual(page.location(),location);assert.equal(page.navigations.length,0);assert.deepEqual(page.scrolls.map((item)=>item.id),['inspection-records','inspection-actions','inspection-records']);assert.equal(page.discardDialog().props.open,false);
  page.navigate('?batch=batch-02','/__preview/batch-archives');assert.equal(page.exitDialog().props.open,true);page.cancelExit();assert.deepEqual(page.location(),location);assert.ok(page.form());assert.equal(page.unload(),true);page.navigate('','/__preview/field-tasks');page.exit();assert.equal(page.location().pathname,'/__preview/field-tasks');assert.equal(page.unload(),false);
});

test('保存失败保留相同表单和未保存状态，重试仅新增一次复验',async()=>{
  const page=fixture();page.click('登记复验');page.dirty();page.failNext();const before=page.state(),key=page.form().key;await assert.rejects(page.save(),/保存失败.*保留/);assert.equal(page.state(),before);assert.equal(page.form().key,key);assert.equal(page.unload(),true);await page.save();assert.equal(page.state().records.length,before.records.length+1);assert.equal(progress(page).qualified,49);assert.equal(page.unload(),false);
});

test('原SIP摘要与提交后的照片从真实记录入口可达，只读仍可查看',async()=>{
  const page=fixture();clickSection(page,'查看 SIP 摘要 SIP-IN100-INSPECT V1.0');assert.equal(page.sheet('检验依据摘要').props.open,true);assert.match(normalized(page.sheet('检验依据摘要')),/SIP-IN100-INSPECT.*V1.0.*原始读数/);page.sheet('检验依据摘要').props.onOpenChange(false);page.render();page.click('登记复验');await page.save({photos:[photo]});role(page,'viewer-a');clickSection(page,`查看照片 ${photo.name}`);assert.equal(page.sheet('检验证据照片').props.open,true);assert.ok(nodes(page.sheet('检验证据照片')).some((node)=>node.type==='img'&&node.props.src===photo.dataUrl));page.sheet('检验证据照片').props.onOpenChange(false);page.render();assert.equal(page.sheet('检验证据照片').props.open,false);
});

test('历史批次初检110加复验6仅累计116，放行100，P09链接精确且全只读',()=>{
  const page=fixture('?task=task-closed');assert.equal(page.section().props.readOnly,true);assert.equal(page.metric('首次检验'),'116 台');assert.equal(page.metric('首次合格'),'110 台');assert.equal(page.metric('首次不合格'),'6 台');assert.equal(progress(page).qualified,116);assert.equal(progress(page).released,100);assert.ok(page.nodes().some((node)=>node.type==='Link'&&node.props.to==='/__preview/batch-archives?tab=inspections&batch=batch-02'));
  for(const view of ['records','issues','releases','history']){page.tab(view);assert.equal(nodes(page.content()).filter((node)=>node.type==='Button'&&node.props.className==='ins-action').length,0);}page.tab('releases');assert.equal(progress(page).releasable,0);assert.match(page.contentText(),/当前可记录放行 0 台/);page.tab('records');assert.match(page.contentText(),/RETEST-0907-02.*原检验.*FQC-0907-02/);assert.match(page.text(),/新增检验不会回写档案/);clickSection(page,'查看 SIP 摘要 SIP-FINAL C');assert.equal(page.sheet('检验依据摘要').props.open,true);assert.match(normalized(page.sheet('检验依据摘要')),/SIP-FINAL.*C/);assert.doesNotMatch(normalized(page.sheet('检验依据摘要')),/SIP-IN100-INSPECT|V1.0/);
});

test('当前任务CSV实际下载且不夹带其他任务，导出失败保留未保存内容',async()=>{
  const page=fixture();role(page,'viewer-a');page.click('导出当前任务');assert.equal(page.downloads[0].download,'IQT-0911-001-检验记录.csv');const csv=await page.blobs[0].text();assert.match(csv,/QC-0911-001/);assert.match(csv,/NCR-0911-001/);assert.doesNotMatch(csv,/QC-0911-003|FQC-0907-02/);assert.deepEqual(page.revoked,['blob:inspection-1']);role(page,'qc-a');page.click('登记复验');page.dirty();page.failExport();page.click('导出当前任务');assert.match(page.text(),/导出未完成/);assert.ok(page.form());assert.equal(page.unload(),true);page.failExport(false);page.click('导出当前任务');assert.equal(await page.blobs[1].text(),csv);
});

test('空态与读取失败恢复已有记录，重置确认前保持新增内容',async()=>{
  const page=fixture();page.click('登记复验');await page.save();const saved=page.state();page.click('空数据');assert.equal(page.section(),undefined);page.click('清除筛选');assert.equal(page.state(),saved);page.click('读取失败');assert.equal(page.section(),undefined);page.click('重试读取');assert.equal(page.state(),saved);page.click('重置演示');const reset=page.nodes().find((node)=>node.type==='AlertDialog'&&normalized(node).includes('重置检验演示'));assert.equal(reset.props.open,true);reset.props.onOpenChange(false);page.render();assert.equal(page.state(),saved);page.click('重置演示');page.click('确认重置');assert.equal(page.state().version,1);assert.equal(progress(page).qualified,47);
});

test('中文操作历史保留真实结果，初检复验量与独立QA记录不混合',async()=>{
  const page=fixture();page.click('登记复验');await page.save();page.tab('history');assert.match(page.contentText(),/登记复验.*QC 检验员.*已登记复验 2 台.*首次检验结果保持不变/);assert.doesNotMatch(page.contentText(),/"taskId"|"actorId"|"kind"/);assert.equal(page.state().releases.filter((item)=>item.taskId==='task-final').length,0);
});

test('生产模式不注册P03预览路由也不加载组件',()=>{
  const source=ts.createSourceFile('App.tsx',read('App.tsx'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);let declaration,spread;function visit(node){if(ts.isVariableDeclaration(node)&&ts.isIdentifier(node.name)&&node.name.text==='InspectionPreviewPage')declaration=node;if(ts.isSpreadElement(node)&&node.getText(source).includes('/__preview/production-inspections'))spread=node;ts.forEachChild(node,visit);}visit(source);assert.ok(declaration);assert.ok(spread);const fragment=`const ${declaration.getText(source)}; export const routes=[${spread.getText(source)}];`.replaceAll('import.meta.env.DEV','__DEV__');for(const dev of [false,true]){const exports={},loads=[];new Function('exports','require','__DEV__','lazyNamed','lazyWrap',compile(fragment))(exports,()=>({jsx,jsxs:jsx}),dev,(loader,name)=>{loads.push(loader);return name;},(element)=>element);assert.equal(loads.length,dev?1:0);assert.deepEqual(exports.routes.map((route)=>route.path),dev?['/__preview/production-inspections']:[]);}
});
