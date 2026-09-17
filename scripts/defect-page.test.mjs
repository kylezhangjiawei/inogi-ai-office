import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

const read = (name) => readFileSync(new URL(`../src/app/${name}`, import.meta.url), 'utf8');
const base = 'production/defects/';
const compile = (source) => ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
const jsx = (type, props, key) => ({ type, props: props ?? {}, key });
const primitives = new Proxy({}, { get: (_, key) => key });
const translate = (value, params = {}) => value.replace(/\{(\w+)\}/g, (match, key) => params[key] ?? match);
class FixedDate extends Date { constructor(...args) { super(...(args.length ? args : ['2026-09-14T04:00:00.000Z'])); } static now() { return Date.parse('2026-09-14T04:00:00.000Z'); } }
const noExternal = () => assert.fail('不良预览不得访问正式接口或持久化存储');
const noStorage = new Proxy({}, { get: noExternal, set: noExternal });
function evaluate(code, dependencies = {}, env = {}) {
  const exports = {};
  new Function('exports', 'require', 'window', 'URL', 'fetch', 'localStorage', 'sessionStorage', 'indexedDB', 'Date', code)(exports, (name) => {
    if (/\/ui\/(?:button|input|native-select|textarea|checkbox|radio-group|slider)$/.test(name)) return { Button: "Button", Input: "Input", NativeSelect: "NativeSelect", Textarea: "Textarea", Checkbox: "Checkbox", RadioGroup: "RadioGroup", RadioGroupItem: "RadioGroupItem", Slider: "Slider" };

    assert.ok(Object.hasOwn(dependencies, name), `未审查的依赖 ${name}`); return dependencies[name];
  }, env.window ?? {}, env.URL ?? URL, noExternal, noStorage, noStorage, noStorage, FixedDate);
  return exports;
}
const types = evaluate(compile(read(`${base}defectTypes.ts`)));
const model = evaluate(compile(read(`${base}defectModel.ts`)));
const pageCode = compile(read(`${base}DefectPreviewPage.tsx`));
const shared = {
  'react/jsx-runtime': { jsx, jsxs: jsx, Fragment: 'Fragment' }, 'lucide-react': primitives,
  '../../lib/i18n': { useI18n: () => ({ t: translate }), i18nLocale: () => 'zh-CN' },
  '../../components/ui/utils': { cn: (...values) => values.filter(Boolean).join(' ') },
  './defectModel': model, './defectTypes': types,
};
const sections = evaluate(compile(read(`${base}DefectSections.tsx`)), { ...shared, '../../components/ui/button': primitives, 'react-router': { Link: 'Link' }, './defect-sections.css': {} });
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
  let cursor = 0, tree, predicate, pending, location = { pathname: '/__preview/production-defects', search: initialSearch }, exportFails = false;
  const blocker = { state: 'unblocked', reset() { pending = undefined; blocker.state = 'unblocked'; }, proceed() { assert.ok(pending); location = pending; pending = undefined; blocker.state = 'unblocked'; } };
  const navigate = (next) => { navigations.push(next); if (predicate?.({ currentLocation: location, nextLocation: next })) { pending = next; blocker.state = 'blocked'; } else location = next; };
  const hooks = {
    useState(initial) { const index = cursor++; if (!(index in slots)) slots[index] = typeof initial === 'function' ? initial() : initial; return [slots[index], (value) => { slots[index] = typeof value === 'function' ? value(slots[index]) : value; }]; },
    useRef(initial) { const index = cursor++; return slots[index] ??= { current: initial }; },
    useCallback(callback, deps) { const index = cursor++, old = slots[index]; if (!old || deps.some((value, i) => !Object.is(value, old.deps[i]))) slots[index] = { callback, deps }; return slots[index].callback; },
    useEffect(effect, deps) { const index = cursor++, old = slots[index]; if (!old || deps.some((value, i) => !Object.is(value, old.deps[i]))) { slots[index] = { deps, cleanup: old?.cleanup }; effects.push(() => { slots[index].cleanup?.(); slots[index].cleanup = effect(); }); } },
  };
  const session = evaluate(compile(read(`${base}defectPreviewSession.ts`)), { './defectModel': model });
  const dependencies = { ...shared, react: hooks, './defectPreviewSession': session,
    'react-router': { useSearchParams: () => [new URLSearchParams(location.search), (params) => navigate({ ...location, search: `?${params}` })], useBlocker: (next) => { predicate = next; return blocker; }, Link: 'Link' },
    '../../order-processing/components/HorizonPage': primitives,
    './DefectSections': { DefectSections: 'DefectSections' }, './DefectActionForm': { DefectActionForm: 'DefectActionForm' },
    '../../order-processing/horizon.css': {}, './defect-preview.css': {},
  };
  for (const name of ['alert-dialog', "button", "input", 'label', "select", 'sheet', 'tabs']) dependencies[`../../components/ui/${name}`] = primitives;
  const exports = evaluate(pageCode, dependencies, { window: {
    addEventListener: (name, handler) => listeners.set(name, handler), removeEventListener: (name, handler) => { if (listeners.get(name) === handler) listeners.delete(name); },
    document: { createElement(name) { assert.equal(name, 'a'); const link = { click() { downloads.push({ href: link.href, download: link.download }); }, remove() {} }; return link; }, body: { appendChild() {} }, getElementById(id) { assert.ok(nodes(tree).some((node) => node.props.id === id), `滚动目标 ${id} 存在`); return { scrollIntoView(options) { scrolls.push({ id, options }); } }; } },
    matchMedia: () => ({ matches: mobile }), setTimeout(callback) { callback(); }, requestAnimationFrame(callback) { callback(); },
  }, URL: { createObjectURL(blob) { if (exportFails) throw new Error('download unavailable'); blobs.push(blob); return `blob:defect-${blobs.length}`; }, revokeObjectURL(url) { revoked.push(url); } } });
  const view = {
    render() { cursor = 0; tree = exports.DefectPreviewPage(); while (effects.length) effects.shift()(); return tree; },
    nodes: () => nodes(tree), text: () => normalized(tree), byType: (type) => nodes(tree).find((node) => node.type === type), byId: (id) => nodes(tree).find((node) => node.props.id === id),
    section: () => view.byType('DefectSections'), form: () => view.byType('DefectActionForm'), state: () => slots.find((value) => value?.issues && value?.repairs && value?.handoffs),
    content() { return view.section() ? sections.DefectSections(view.section().props) : null; }, contentText() { return normalized(view.content()); },
    sheet: (title) => view.nodes().find((node) => node.type === 'Sheet' && (!title || normalized(node).includes(title))), params: () => new URLSearchParams(location.search), location: () => ({ ...location }), downloads, blobs, revoked, navigations, scrolls,
    button(label) { return view.nodes().find((node) => ['Button', 'AlertDialogAction', 'AlertDialogCancel'].includes(node.type) && (node.props['aria-label'] === label || normalized(node) === label)); },
    click(label) { const node = view.button(label); assert.ok(node, `${label} exists`); assert.equal(Boolean(node.props.disabled), false, `${label} enabled`); node.props.onClick(); return view.render(); },
    input(id, value) { const node = view.byId(id); assert.ok(node, id); node.props.onChange({ target: { value } }); return view.render(); },
    select(id, value) { const node = view.nodes().find((node) => node.type === 'Select' && nodes(node).some((child) => child.props.id === id)); assert.ok(node, id); node.props.onValueChange(value); return view.render(); },
    tab(value) { view.byType('Tabs').props.onValueChange(value); return view.render(); },
    action(context) { view.section().props.onAction(context); return view.render(); },
    dirty(value = true) { view.form().props.onDirtyChange(value); return view.render(); },
    discardDialog: () => view.nodes().find((node) => node.type === 'AlertDialog' && /放弃尚未保存/.test(normalized(node))),
    exitDialog: () => view.nodes().find((node) => node.type === 'AlertDialog' && /离开当前不良处理/.test(normalized(node))),
    cancelDiscard() { view.discardDialog().props.onOpenChange(false); return view.render(); },
    discard() { view.click('放弃并继续'); return view.render(); },
    cancelExit() { nodes(view.exitDialog()).find((node) => node.type === 'AlertDialogCancel').props.onClick(); return view.render(); },
    exit() { view.click('放弃并离开'); return view.render(); },
    failNext() { view.nodes().find((node) => node.type === "Checkbox").props.onCheckedChange(true); return view.render(); },
    failExport(value = true) { exportFails = value; },
    inputAction(patch = {}) {
      const props=view.form().props, context=props.context;
      const common={kind:context.kind,actorId:props.actorId,issueId:context.issueId,reviewed:true};
      const issue=view.state().issues.find((item)=>item.id===context.issueId);
      return {...common,...({
        assign:{ownerId:'line-a',dueDate:'2026-09-18',priority:'high',reason:'明确现场责任人跟进并核对剩余范围'},
        route:{direction:context.direction??'onsite',ownerId:'line-a',dueDate:'2026-09-18',description:'核对装配记录并复查不良范围',causeStatus:'pending',cause:''},
        repair:{date:'2026-09-14',quantity:1,description:'完成连接器重装并核对接触状态',basis:'按现场整改记录核对1件已完成措施',photos:[]},
        handoff:{repairId:context.repairId??view.state().repairs.find((item)=>item.issueId===issue.id)?.id,quantity:1},
        close:{summary:'核对全部复验合格回执后关闭本异常'}
      }[context.kind]),...patch};
    },
    async save(patch = {}) { try { await view.form().props.onSubmit(view.inputAction(patch)); } finally { view.render(); } },
    navigate(search, pathname = location.pathname) { navigate({ pathname, search }); return view.render(); },
    unload() { const event = { prevented: false, preventDefault() { this.prevented = true; } }; listeners.get('beforeunload')?.(event); return event.prevented; },
    metric(label) { const section = view.nodes().find((node) => node.type === 'dl' && node.props.className === 'dp-numbers'); const pair = nodes(section).find((node) => node.type === 'div' && normalized(node.props.children?.[0]) === label); return normalized(pair?.props.children?.[1]); },
  };
  view.render(); return view;
}
const currentIssue=(page)=>page.state().issues.find((item)=>item.id===page.section()?.props.issueId);
const progress=(page)=>model.getDefectProgress(page.state(),currentIssue(page).id);
const role=(page,id)=>page.select('defect-actor',id);
function clickSection(page,label) {const node=nodes(page.content()).find((node)=>['Button'].includes(node.type)&&(node.props['aria-label']===label||normalized(node)===label));assert.ok(node,label);assert.equal(Boolean(node.props.disabled),false);node.props.onClick();page.render();}
const photoData='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl1cAAAAASUVORK5CYII=';
const photo={id:'photo-local',name:'原始检验照片.png',type:'image/png',size:Buffer.from(photoData,'base64').length,dataUrl:`data:image/png;base64,${photoData}`};

const renderSection = (patch={}) => sections.DefectSections({state:model.createDefectState(),issueId:'issue-final',view:'overview',readOnly:false,actorId:'quality-a',onAction(){},onPhoto(){},...patch});

test('问题视图保留原终检3台及来源链接，原因待确认不强制根因',()=>{
  const tree=renderSection(),content=normalized(tree);
  assert.match(content,/功能异常/);assert.match(content,/原因待确认/);assert.match(fixture().text(),/尚未解决 3 台/);assert.match(fixture().text(),/复验合格 0 台/);assert.match(content,/原业务单号 QC-0911-001/);
  const links=nodes(tree).filter((node)=>node.type==='Link');assert.deepEqual(links.map((node)=>node.props.to),['/__preview/production-inspections?task=task-final&tab=records']);
  assert.match(content,/独立预览.*不会同步修改/);assert.match(content,/尚未发送给研发或采购/);
});

test('现场原来源准确指向P02的task和defects分类',()=>{
  const tree=renderSection({issueId:'issue-field'});
  assert.match(normalized(tree),/DEFECT-0911-001/);assert.match(normalized(tree),/原不良范围 2 件/);
  assert.deepEqual(nodes(tree).filter((node)=>node.type==='Link').map((node)=>node.props.to),['/__preview/field-tasks?task=task-active&tab=defects']);
});

test('历史来源同时保留P03原任务和P09原批次，归档量不被复验重复相加',()=>{
  const tree=renderSection({issueId:'issue-verified'}),content=normalized(tree);
  assert.match(content,/FQC-0907-02/);assert.match(fixture('?issue=issue-verified').text(),/复验合格 6 台/);assert.match(fixture('?issue=issue-verified').text(),/尚未解决 0 台/);
  assert.deepEqual(nodes(tree).filter((node)=>node.type==='Link').map((node)=>node.props.to),['/__preview/production-inspections?task=task-closed&tab=records','/__preview/batch-archives?tab=inspections&batch=batch-02']);
});

test('整改卡片按固定整改ID发起交接，使用尚可提交余额',()=>{
  let opened;const tree=renderSection({view:'repairs',onAction(context){opened=context;}}),content=normalized(tree);
  assert.match(content,/尚待整改 1 台/);assert.match(content,/整改后待交接 2 台/);
  const button=nodes(tree).find((node)=>node.props['aria-label']==='提交复验 DISP-0911-001');assert.ok(button);button.props.onClick();assert.deepEqual(opened,{kind:'handoff',issueId:'issue-final',repairId:'repair-ready'});
  assert.equal(nodes(tree).filter((node)=>node.type==='details').length,1);
});

test('整改量被交接后按钮消失但未解决数量不变，回执尚未伪造',()=>{
  let state=model.createDefectState();state=model.applyDefectAction(state,state.version,{kind:'handoff',issueId:'issue-final',actorId:'quality-a',repairId:'repair-ready',quantity:2,reviewed:true});
  const tree=renderSection({state,view:'repairs'});assert.equal(nodes(tree).some((node)=>node.props['aria-label']==='提交复验 DISP-0911-001'),false);
  const receipt=renderSection({state,view:'reinspection'});assert.match(normalized(receipt),/已送待复验 2 台/);assert.match(normalized(receipt),/尚未收到 QC 复验结果/);assert.equal(model.getDefectProgress(state,'issue-final').remaining,3);assert.equal(state.receipts.filter((entry)=>entry.issueId==='issue-final').length,0);
});

test('复验失败回执分别展示本次3台2合格1不良，无编辑入口',()=>{
  const tree=renderSection({issueId:'issue-retest-failed',view:'reinspection'}),content=normalized(tree);
  assert.match(content,/RETEST-0911-PREVIEW/);assert.match(content,/复验量 3 台 合格 2 台 不良 1 台/);assert.match(content,/未通过部分继续在原异常内处理/);assert.match(content,/SIP 版本 V1.0/);
  assert.equal(nodes(tree).filter((node)=>['Button','Input','Textarea'].includes(node.type)).length,0);
});

test('查看岗QC及只读场景都不出现整改和交接按钮',()=>{
  for(const patch of [{actorId:'qc-a'},{actorId:'viewer-a'},{readOnly:true},{actorId:'line-b'}]) {
    const tree=renderSection({view:'repairs',...patch});assert.equal(nodes(tree).filter((node)=>node.type==='Button').length,0);
  }
});

test('照片展开后通过原照片对象打开，不将图片字节写入说明',()=>{
  const state=model.createDefectState();state.repairs[0].photos=[photo];let opened;
  const tree=renderSection({state,view:'repairs',onPhoto(value){opened=value;}}),button=nodes(tree).find((node)=>node.props['aria-label']===`查看照片 ${photo.name}`);
  assert.ok(button);button.props.onClick();assert.equal(opened,photo);assert.equal(nodes(tree).find((node)=>node.type==='img').props.src,photo.dataUrl);assert.doesNotMatch(normalized(tree),/base64/);
});

test('协同保留同一异常和指定下一责任人，只链接对应 P04 原异常',()=>{
  let state=model.createDefectState();state=model.applyDefectAction(state,state.version,{kind:'route',issueId:'issue-process',actorId:'quality-a',direction:'rd',ownerId:'rd-a',dueDate:'2026-09-18',description:'请研发复核通信接口异常',causeStatus:'pending',cause:'',reviewed:true});
  const tree=renderSection({state,issueId:'issue-process'});assert.match(normalized(tree),/研发协同.*研发协同岗/);assert.match(normalized(tree),/请研发复核通信接口异常/);assert.match(normalized(tree),/发起人 质量管理岗/);assert.equal(state.issues.length,6);
  assert.deepEqual(nodes(tree).filter((node)=>node.type==='Link'&&/quality-exceptions|production-rd/.test(node.props.to)).map((node)=>node.props.to),['/__preview/production-rd?issue=issue-process']);
});

test('操作记录按原异常筛选，缺失ID安全显示重新选择',()=>{
  const tree=renderSection({view:'history'});assert.match(normalized(tree),/2 台现场整改完成/);assert.doesNotMatch(normalized(tree),/依据既有 QC 合格回执关闭/);
  assert.match(normalized(renderSection({issueId:'missing'})),/未找到不良记录.*重新选择/);
});

test('默认异常3台保留全部原始范围，整改待交接2台且未自动合格',()=>{
  const page=fixture();assert.equal(currentIssue(page).id,'issue-final');assert.equal(page.nodes().filter((node)=>node.type==='TabsTrigger').length,4);
  for(const [label,value] of [['原不良范围','3 台'],['复验合格','0 台'],['已整改待交接','2 台'],['等待复验回执','0 台'],['尚未解决','3 台']])assert.equal(page.metric(label),value);
  assert.equal(page.button('关闭不良').props.disabled,true);assert.equal(page.button('提交复验').props.disabled,false);assert.match(page.contentText(),/QC-0911-001/);
});

test('整改与交接保存各自更新范围，首次不良和QC合格保持不变',async()=>{
  const page=fixture();page.click('登记现场整改');page.dirty();await page.save();assert.equal(page.params().get('tab'),'repairs');assert.equal(progress(page).ready,3);assert.equal(progress(page).availableToRepair,0);assert.equal(progress(page).remaining,3);assert.equal(progress(page).resolved,0);assert.equal(page.form(),undefined);
  clickSection(page,'提交复验 DISP-0911-001');assert.equal(page.form().props.context.repairId,'repair-ready');await page.save({quantity:2});assert.equal(page.params().get('tab'),'reinspection');assert.equal(progress(page).pendingReinspection,2);assert.equal(progress(page).ready,1);assert.equal(progress(page).remaining,3);assert.match(page.contentText(),/尚未收到 QC 复验结果/);
});

test('保存失败保留相同表单及原数量，重试只新增一次整改',async()=>{
  const page=fixture();page.click('登记现场整改');page.dirty();const form=page.form().props.context,before=structuredClone(page.state());page.failNext();await assert.rejects(page.save(),/保存失败/);assert.deepEqual(page.state(),before);assert.deepEqual(page.form().props.context,form);assert.equal(page.unload(),true);await page.save();assert.equal(page.state().repairs.length,before.repairs.length+1);assert.equal(page.unload(),false);
});

test('超整改余额或超交接范围由模型阻断且保持页面上下文',async()=>{
  const page=fixture();page.click('登记现场整改');const before=structuredClone(page.state());await assert.rejects(page.save({quantity:2}),/1/);assert.deepEqual(page.state(),before);assert.equal(page.form().props.context.kind,'repair');page.form().props.onCancel();page.render();page.click('提交复验');await assert.rejects(page.save({quantity:3}),/2/);assert.deepEqual(page.state(),before);
});

test('质量可指派但产线仅看本人任务，QC和查看岗位无写入口',()=>{
  const page=fixture();assert.ok(page.button('指派责任人'));role(page,'line-a');assert.equal(page.button('指派责任人'),undefined);assert.ok(page.button('登记现场整改'));assert.equal(page.button('查看不良 NC-PRO-0911-003'),undefined);
  role(page,'line-b');assert.equal(currentIssue(page).id,'issue-closed');assert.equal(page.section().props.readOnly,true);
  for(const id of ['qc-a','viewer-a']){role(page,id);assert.equal(page.section().props.readOnly,true);assert.equal(page.button('登记现场整改'),undefined);assert.equal(page.button('关闭不良'),undefined);}
});

test('未知原因的过程不良可以转研发且只保存协同记录',async()=>{
  const page=fixture('?issue=issue-process');page.click('转研发');assert.equal(page.form().props.context.direction,'rd');await page.save({ownerId:'rd-a'});assert.equal(currentIssue(page).direction,'rd');assert.equal(currentIssue(page).causeStatus,'pending');assert.equal(currentIssue(page).quantity,6);assert.equal(page.state().collaborations.length,1);assert.match(page.text(),/外部协同尚未发送/);assert.equal(page.state().receipts.length,3);
});

test('固定外协方向及整改来源不能被旧表单提交篡改',async()=>{
  const page=fixture('?issue=issue-process');page.click('转采购');const before=structuredClone(page.state());await assert.rejects(page.save({direction:'rd',ownerId:'rd-a'}),/来源或处理方向/);assert.deepEqual(page.state(),before);
  page.form().props.onCancel();page.render();page.click('查看不良 NCR-0911-001');page.tab('repairs');clickSection(page,'提交复验 DISP-0911-001');await assert.rejects(page.save({repairId:'repair-verified'}),/来源或处理方向/);
});

test('已经QC全量复验合格的历史记录才可由质量关闭',async()=>{
  const page=fixture('?issue=issue-verified');assert.equal(page.button('关闭不良').props.disabled,false);const source=structuredClone(page.state().receipts);page.click('关闭不良');await page.save();assert.ok(currentIssue(page).closedAt);assert.equal(page.params().get('tab'),'history');assert.equal(page.section().props.readOnly,true);assert.equal(page.button('关闭不良'),undefined);assert.deepEqual(page.state().receipts,source);assert.equal(progress(page).resolved,6);
});

test('关闭前的未关闭筛选在成功后自动恢复并保留所选记录',async()=>{
  const page=fixture();page.select('defect-status','open');page.click('查看不良 NCR-0907-02');page.click('关闭不良');await page.save();assert.equal(currentIssue(page).id,'issue-verified');assert.equal(page.params().get('issue'),'issue-verified');assert.ok(currentIssue(page).closedAt);
});

test('复验未通过只允许剩余1台重做，不把旧2台合格重新处理',async()=>{
  const page=fixture('?issue=issue-retest-failed');assert.equal(progress(page).remaining,1);assert.equal(progress(page).resolved,2);page.click('登记现场整改');await assert.rejects(page.save({quantity:2}),/1/);await page.save({quantity:1});assert.equal(currentIssue(page).quantity,3);assert.equal(progress(page).resolved,2);assert.equal(progress(page).remaining,1);assert.equal(progress(page).availableToRepair,0);
});

test('切换分类前可继续填写或确认放弃，旧回调不能跨上下文写入',async()=>{
  const page=fixture();page.click('登记现场整改');page.dirty();const oldSubmit=page.form().props.onSubmit,oldAction=page.inputAction();page.tab('history');assert.equal(page.discardDialog().props.open,true);assert.equal(page.params().get('tab'),null);page.cancelDiscard();assert.ok(page.form());page.tab('history');page.discard();assert.equal(page.params().get('tab'),'history');assert.equal(page.form(),undefined);const before=structuredClone(page.state());await assert.rejects(oldSubmit(oldAction),/已变化/);assert.deepEqual(page.state(),before);
});

test('切换操作人使旧回调失效且已保存事实保留',async()=>{
  const page=fixture();page.click('登记现场整改');const oldSubmit=page.form().props.onSubmit,oldAction=page.inputAction();role(page,'line-a');const before=structuredClone(page.state());await assert.rejects(oldSubmit(oldAction),/已变化/);assert.deepEqual(page.state(),before);assert.equal(page.section().props.actorId,'line-a');assert.equal(currentIssue(page).id,'issue-final');
});

test('脏表单切换原异常需要确认，确认后保留原任务已保存事实',()=>{
  const page=fixture();page.click('登记现场整改');page.dirty();page.click('查看不良 NC-PRO-0911-003');assert.equal(currentIssue(page).id,'issue-final');page.discard();assert.equal(currentIssue(page).id,'issue-process');assert.equal(page.form(),undefined);assert.equal(page.state().repairs.filter((item)=>item.issueId==='issue-final').length,1);
});

test('输入筛选在确认后使用原事件值，清空和错误场景都可恢复',()=>{
  const page=fixture();page.click('登记现场整改');page.dirty();const input=page.byId('defect-query'),event={target:{value:'工业阀'}};input.props.onChange(event);event.target.value='';page.render();page.discard();assert.equal(page.byId('defect-query').props.value,'工业阀');assert.equal(currentIssue(page).id,'issue-process');page.click('空数据');assert.equal(page.section(),undefined);page.click('清除筛选');assert.equal(currentIssue(page).id,'issue-final');page.click('读取失败');assert.match(page.text(),/生产不良读取失败/);assert.equal(page.section(),undefined);page.click('重试读取');assert.equal(currentIssue(page).id,'issue-final');
});

test('区域跳转仅滚动不变URL，不触发未保存对话框',()=>{
  const page=fixture('',true);page.click('登记现场整改');page.dirty();const before=page.location();page.click('查看处理记录');page.click('前往处理操作');assert.deepEqual(page.location(),before);assert.equal(page.discardDialog().props.open,false);assert.ok(page.form());assert.deepEqual(page.scrolls.map((item)=>item.id),['defect-actions','defect-records','defect-actions']);
});

test('外部路由跳转及刷新在有未保存填写时保护，允许取消或继续',()=>{
  const page=fixture();page.click('登记现场整改');page.dirty();page.navigate('?task=task-final','/__preview/production-inspections');assert.equal(page.exitDialog().props.open,true);assert.equal(page.unload(),true);page.cancelExit();assert.equal(page.location().pathname,'/__preview/production-defects');page.navigate('?task=task-final','/__preview/production-inspections');page.exit();assert.equal(page.location().pathname,'/__preview/production-inspections');assert.equal(page.unload(),false);
});

test('导出当前异常包含来源和处置且不混入其他异常，失败保留填写',async()=>{
  const page=fixture();page.click('导出当前不良');assert.equal(page.downloads.length,1);assert.equal(page.downloads[0].download,'NCR-0911-001-不良处理记录.csv');const content=await page.blobs[0].text();assert.match(content,/QC-0911-001/);assert.match(content,/DISP-0911-001/);assert.doesNotMatch(content,/FQC-0907-02/);assert.deepEqual(page.revoked,['blob:defect-1']);
  page.click('登记现场整改');page.dirty();page.failExport();page.click('导出当前不良');assert.match(page.text(),/导出未完成/);assert.ok(page.form());assert.equal(page.unload(),true);
});

test('初始常用项不作为历史排名，显示样例统计后按产线去重',()=>{
  const page=fixture();assert.match(page.text(),/初始常用现象/);assert.doesNotMatch(page.text(),/近期高频现象 Top10/);page.click('查看近期样例统计');assert.match(page.text(),/近 30 天演示样本/);page.select('defect-line','line-b');const list=page.nodes().find((node)=>node.props.className==='dp-rank-list');assert.ok(list);assert.match(normalized(list),/装配干涉 2 次/);assert.doesNotMatch(normalized(list),/功能异常/);
});

test('不认识的异常或分类参数安全恢复，不显示错误来源',()=>{
  const page=fixture('?issue=missing&tab=repairs');assert.equal(page.section(),undefined);assert.match(page.text(),/当前范围没有可查看的不良/);page.click('清除筛选');assert.equal(currentIssue(page).id,'issue-final');const view=fixture('?tab=unknown');assert.equal(view.section().props.view,'overview');assert.equal(currentIssue(view).id,'issue-final');
});

test('重置演示经确认后恢复全部原始数量与上下文',async()=>{
  const page=fixture();page.click('登记现场整改');await page.save();assert.equal(progress(page).ready,3);page.click('重置演示');const dialog=page.nodes().find((node)=>node.type==='AlertDialog'&&/重置不良处理演示/.test(normalized(node)));assert.equal(dialog.props.open,true);page.click('确认重置');assert.equal(progress(page).ready,2);assert.equal(page.params().get('issue'),null);assert.equal(page.params().get('tab'),'overview');assert.equal(page.state().version,1);
});
