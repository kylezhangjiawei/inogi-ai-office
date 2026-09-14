import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

const read = (path) => readFileSync(new URL(`../src/app/${path}`, import.meta.url), 'utf8');
const compile = (source) => ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
const pageSource = read('procurement/quality/QualityExceptionsPreviewPage.tsx');
const pageCode = compile(pageSource);
const jsx = (type, props, key) => ({ type, props: props ?? {}, key });
const primitives = new Proxy({}, { get: (_target, name) => name });
const translate = (value, params = {}) => value.replace(/\{(\w+)\}/g, (match, key) => params[key] ?? match);
const noExternalAccess = () => assert.fail('演示页面不能访问接口或持久化存储');
const noStorage = new Proxy({}, { get: noExternalAccess, set: noExternalAccess });
class FixedDate extends Date {
  constructor(...args) { super(...(args.length ? args : ['2026-09-10T01:00:00.000Z'])); }
  static now() { return new Date('2026-09-10T01:00:00.000Z').getTime(); }
}
function evaluate(code, dependencies = {}, environment = {}) {
  const exports = {};
  new Function('exports', 'require', 'crypto', 'Date', 'fetch', 'localStorage', 'sessionStorage', 'indexedDB', 'window', 'document', code)(
    exports, (name) => { assert.ok(Object.hasOwn(dependencies, name), `页面不应加载未审查依赖：${name}`); return dependencies[name]; },
    { randomUUID }, FixedDate, noExternalAccess, noStorage, noStorage, noStorage, environment.window ?? {}, environment.document ?? {},
  );
  return exports;
}
const model = evaluate(compile(read('procurement/quality/qualityExceptionPreviewModel.ts')));
const types = evaluate(compile(read('procurement/quality/qualityExceptionTypes.ts')));
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
const normalized = (node) => text(node).replace(/\s+/g, ' ').trim();
const actionInput = (kind, patch = {}) => ({ ...{
  assign: { owner: '演示采购员', verifier: '演示质量员', dueDate: '2026-09-12', note: '演示页面分派' },
  cause: { category: 'process', detail: '演示页面主因', responsibility: '演示人工确认责任', evidence: 'DEMO-CAUSE-EVIDENCE' },
  disposition: { method: 'repair', handledQty: 4, detail: '演示页面完成处置', evidence: 'DEMO-DISPOSITION-EVIDENCE' },
  submit_verification: { note: '演示页面提交复检' }, verify: { quantity: 4, result: 'passed', note: '演示页面全量复检', evidence: 'DEMO-VERIFY-EVIDENCE' },
  close: { note: '演示页面确认关闭' }, feedback: { source: 'production', reference: 'DEMO-PAGE-FEEDBACK', note: '演示页面反馈说明' },
}[kind], kind, ...patch });
const newInput = (patch = {}) => ({ source: 'warehouse', discoveredDate: '2026-09-10', materialCode: 'DEMO-PAGE-MAT', materialName: '演示页面新物料', category: '机加工件', spec: '', unit: '件', supplierName: '演示供应商', batchNo: 'DEMO-PAGE-BATCH', orderNo: '', inspectedQty: 10, defectiveQty: 2, phenomenon: '演示页面现象', evidence: '演示页面原始依据', ...patch });

function fixture(initialSearch = '') {
  const slots = [], setters = [], effects = [], listeners = new Map(), focused = [];
  let cursor = 0, tree, blockerPredicate, pendingLocation;
  let location = { pathname: '/__preview/quality-exceptions', search: initialSearch };
  const blocker = { state: 'unblocked', reset() { pendingLocation = undefined; blocker.state = 'unblocked'; }, proceed() { assert.ok(pendingLocation, '有待继续的导航'); location = pendingLocation; pendingLocation = undefined; blocker.state = 'unblocked'; } };
  const navigate = (next) => {
    if (blockerPredicate?.({ currentLocation: location, nextLocation: next })) { pendingLocation = next; blocker.state = 'blocked'; }
    else location = next;
  };
  const hooks = {
    useState(initial) { const index = cursor++; if (!(index in slots)) slots[index] = typeof initial === 'function' ? initial() : initial; setters[index] ??= (value) => { slots[index] = typeof value === 'function' ? value(slots[index]) : value; }; return [slots[index], setters[index]]; },
    useRef(initial) { const index = cursor++; return slots[index] ??= { current: initial }; },
    useCallback(callback, deps) { const index = cursor++; const old = slots[index]; if (!old || deps.some((value, i) => !Object.is(value, old.deps[i]))) slots[index] = { callback, deps }; return slots[index].callback; },
    useEffect(effect, deps) {
      const index = cursor++, old = slots[index];
      if (!old || deps.some((value, i) => !Object.is(value, old.deps[i]))) {
        slots[index] = { deps, cleanup: old?.cleanup };
        effects.push(() => { slots[index].cleanup?.(); slots[index].cleanup = effect(); });
      }
    },
  };
  const dependencies = {
    react: hooks, 'react/jsx-runtime': { jsx, jsxs: jsx, Fragment: 'Fragment' }, 'lucide-react': primitives,
    'react-router': {
      useSearchParams: () => [new URLSearchParams(location.search), (params) => { const search = params.toString(); navigate({ ...location, search: search ? `?${search}` : '' }); }],
      useBlocker: (predicate) => { blockerPredicate = predicate; return blocker; },
    },
    '../../lib/i18n': { useI18n: () => ({ t: translate }), i18nLocale: () => 'zh-CN' },
    '../../order-processing/components/HorizonPage': primitives,
    '../../components/ui/utils': { cn: (...values) => values.filter(Boolean).join(' ') },
    './QualityExceptionActionForm': { QualityExceptionActionForm: 'QualityExceptionActionForm' },
    './QualityExceptionCreateDialog': { QualityExceptionCreateDialog: 'QualityExceptionCreateDialog' },
    './qualityExceptionPreviewModel': model, './qualityExceptionTypes': types,
    '../../order-processing/horizon.css': {}, './quality-exceptions-preview.css': {},
  };
  for (const component of ['alert-dialog', 'button', 'input', 'label', 'select', 'tabs']) dependencies[`../../components/ui/${component}`] = primitives;
  const exports = evaluate(pageCode, dependencies, {
    window: { addEventListener: (event, callback) => listeners.set(event, callback), removeEventListener: (event, callback) => { if (listeners.get(event) === callback) listeners.delete(event); } },
    document: { getElementById: (id) => nodes(tree).some((node) => node.props.id === id) ? { focus: () => focused.push(id) } : null },
  });
  const view = {
    render() { cursor = 0; tree = exports.QualityExceptionsPreviewPage(); while (effects.length) effects.shift()(); return tree; },
    nodes() { return nodes(tree); }, text() { return normalized(tree); },
    byType(type) { return view.nodes().find((node) => node.type === type); },
    byId(id) { return view.nodes().find((node) => node.props.id === id); },
    form() { return view.byType('QualityExceptionActionForm'); }, create() { return view.byType('QualityExceptionCreateDialog'); },
    dialog() { return view.byType('AlertDialog'); }, rows() { return view.nodes().filter((node) => node.props.className === 'qep-list-row'); },
    rowCodes() { return view.rows().map((node) => normalized(node).match(/DEMO-NC-\d+/)?.[0]); },
    params() { return new URLSearchParams(location.search); }, location() { return { ...location }; }, focused,
    button(label) { return view.nodes().find((node) => ['Button', 'button', 'AlertDialogAction', 'AlertDialogCancel'].includes(node.type) && normalized(node) === label); },
    click(label) { const button = view.button(label); assert.ok(button, `${label} exists`); assert.equal(Boolean(button.props.disabled), false, `${label} enabled`); button.props.onClick(); return view.render(); },
    open(code) { const row = view.rows().find((node) => normalized(node).includes(code)); assert.ok(row, `${code} row exists`); nodes(row).find((node) => node.type === 'Button').props.onClick(); return view.render(); },
    source(value) { return view.click(value === 'all' ? '全部' : types.qualitySourceLabels[value]); },
    currentSource() { const group = view.nodes().find((node) => node.props.className === 'qep-source-tabs'); const pressed = nodes(group).find((node) => node.type === 'Button' && node.props['aria-pressed']); const label = normalized(pressed); return label === '全部' ? 'all' : Object.keys(types.qualitySourceLabels).find((key) => types.qualitySourceLabels[key] === label); },
    input(id, value) { view.byId(id).props.onChange({ target: { value } }); return view.render(); },
    select(id, value) { const selected = view.nodes().find((node) => node.type === 'Select' && nodes(node).some((child) => child.props.id === id)); assert.ok(selected, `${id} exists`); selected.props.onValueChange(value); return view.render(); },
    action(kind) { return view.select('quality-current-action', kind); },
    dirty(value = true) { view.form().props.onDirtyChange(value); return view.render(); },
    createDirty(value = true) { view.create().props.onDirtyChange(value); return view.render(); },
    cancelDiscard() { view.dialog().props.onOpenChange(false); return view.render(); },
    discard() { view.click('放弃并继续'); view.dialog().props.onOpenChange(false); return view.render(); },
    failNext(value = true) { view.nodes().find((node) => node.type === 'input' && node.props.type === 'checkbox').props.onChange({ target: { checked: value } }); return view.render(); },
    async save(patch = {}) { const form = view.form(); assert.ok(form, '当前有动作表单'); try { await form.props.onSubmit(actionInput(form.props.kind, patch)); form.props.onDirtyChange(false); } finally { view.render(); } },
    async saveNew(patch = {}) { const dialog = view.create(); assert.ok(dialog.props.open, '新建弹窗已打开'); try { await dialog.props.onSubmit(newInput(patch)); dialog.props.onOpenChange(false); } finally { view.render(); } },
    navigate(search, pathname = location.pathname) { navigate({ pathname, search }); return view.render(); },
    beforeUnload() { const event = { prevented: false, returnValue: undefined, preventDefault() { this.prevented = true; } }; listeners.get('beforeunload')?.(event); return event; },
  };
  view.render(); return view;
}

test('默认来料列表只显示三张来料异常，主因按单数而非混合数量统计', () => {
  const page = fixture(); assert.equal(page.currentSource(), 'incoming');
  assert.deepEqual(page.rowCodes(), ['DEMO-NC-001', 'DEMO-NC-002', 'DEMO-NC-003']);
  assert.match(page.text(), /演示数据，刷新后恢复/); assert.match(page.text(), /不生成正式业务记录/); assert.match(page.text(), /不同单位的物料数量不相加/);
  page.source('all'); assert.equal(page.rows().length, 6); assert.match(page.text(), /2 \/ 20 台/);
  page.source('production'); assert.deepEqual(page.rowCodes(), ['DEMO-NC-005']);
});

test('来源、状态、日期、主因与关键字叠加筛选，进入详情和返回不丢筛选', () => {
  const page = fixture(); page.source('all'); page.select('quality-filter-status', 'processing');
  page.input('quality-query', '演示供应商 A'); page.input('quality-date-from', '2026-09-08'); page.input('quality-date-to', '2026-09-08');
  page.click('工艺 1'); assert.deepEqual(page.rowCodes(), ['DEMO-NC-005']);
  page.open('DEMO-NC-005'); assert.equal(page.form().props.issue.id, 'demo-quality-005');
  page.click('返回异常列表'); assert.deepEqual(page.rowCodes(), ['DEMO-NC-005']);
  assert.equal(page.currentSource(), 'all'); assert.equal(page.byId('quality-query').props.value, '演示供应商 A');
  assert.equal(page.byId('quality-date-from').props.value, '2026-09-08'); assert.equal(page.byId('quality-date-to').props.value, '2026-09-08');
  assert.equal(page.focused.at(-1), 'quality-open-demo-quality-005');
  page.click('清除主因筛选'); page.click('重置筛选'); assert.deepEqual(page.rowCodes(), ['DEMO-NC-001', 'DEMO-NC-002', 'DEMO-NC-003']);
});

test('日期倒置显示就地错误和可恢复空态，搜索零匹配可清除全部来源筛选', () => {
  const page = fixture(); page.input('quality-date-from', '2026-09-10'); page.input('quality-date-to', '2026-09-08');
  assert.equal(page.byId('quality-date-from').props['aria-invalid'], true); assert.equal(page.byId('quality-date-to').props['aria-describedby'], 'quality-date-error');
  assert.match(page.text(), /开始日期不能晚于结束日期/); assert.match(page.text(), /请先修正日期范围/); assert.equal(page.rows().length, 0);
  page.click('清除全部筛选'); assert.equal(page.rows().length, 6); assert.equal(page.currentSource(), 'all');
  page.input('quality-query', '不存在的物料'); assert.match(page.text(), /没有匹配的异常/); page.click('清除全部筛选'); assert.equal(page.rows().length, 6);
});

test('动作改状态后返回列表即更新并遵守原状态筛选，历史显示实际记录', async () => {
  const page = fixture(); page.select('quality-filter-status', 'unassigned'); assert.deepEqual(page.rowCodes(), ['DEMO-NC-001']);
  page.open('DEMO-NC-001'); await page.save();
  assert.equal(page.form().props.issue.status, 'processing'); assert.match(page.text(), /已保存分派经办演示记录/); assert.match(page.text(), /演示页面分派/);
  page.click('返回异常列表'); assert.equal(page.rows().length, 0); assert.match(page.text(), /没有匹配的异常/);
  page.select('quality-filter-status', 'processing'); assert.deepEqual(page.rowCodes(), ['DEMO-NC-001', 'DEMO-NC-002']);
  page.open('DEMO-NC-001'); assert.equal(page.form().props.issue.owner, '演示采购员'); assert.equal(page.form().props.issue.responsibility, '');
});

test('保存动作即时切换有效操作，完整闭环到只读关闭页且原不良数量不变', async () => {
  const page = fixture('?issue=demo-quality-001'); await page.save(); page.action('cause'); await page.save();
  page.action('disposition'); await page.save(); page.action('submit_verification'); await page.save();
  assert.equal(page.form().props.kind, 'verify'); assert.equal(page.form().props.issue.verificationRound, 1); await page.save();
  assert.equal(page.form().props.kind, 'close'); assert.equal(page.form().props.issue.verificationResult, 'passed'); await page.save();
  assert.equal(page.form(), undefined); assert.match(page.text(), /此异常已关闭/); assert.match(page.text(), /不代表物料已经放行或库存释放/);
  assert.match(page.text(), /不良数量 4 件/); assert.match(page.text(), /演示页面确认关闭/);
});

test('新建成功使用实际新id打开详情，来源筛选跟随新单且返回可找到新记录', async () => {
  const page = fixture(); page.click('登记演示异常'); assert.equal(page.create().props.open, true);
  await page.saveNew(); const id = page.params().get('issue'); assert.match(id, /^demo-quality-[0-9a-f-]{36}$/);
  assert.equal(page.create().props.open, false); assert.equal(page.form().props.issue.id, id); assert.equal(page.form().props.issue.code, 'DEMO-NC-007');
  assert.equal(page.form().props.issue.materialName, '演示页面新物料'); assert.equal(page.form().props.kind, 'assign');
  page.click('返回异常列表'); assert.equal(page.currentSource(), 'warehouse'); assert.deepEqual(page.rowCodes(), ['DEMO-NC-007', 'DEMO-NC-004']);
  page.open('DEMO-NC-007'); assert.equal(page.form().props.issue.id, id);
});

test('创建失败不丢弹窗且不生成幽灵记录，重试只新增一张异常', async () => {
  const page = fixture(); page.failNext(); page.click('登记演示异常');
  await assert.rejects(page.saveNew(), /填写内容已保留/); assert.equal(page.create().props.open, true); assert.equal(page.params().get('issue'), null);
  assert.deepEqual(page.rowCodes(), ['DEMO-NC-001', 'DEMO-NC-002', 'DEMO-NC-003']);
  assert.equal(page.nodes().find((node) => node.type === 'input' && node.props.type === 'checkbox').props.checked, false);
  await page.saveNew(); assert.equal(page.form().props.issue.code, 'DEMO-NC-007'); page.click('返回异常列表'); page.source('all'); assert.equal(page.rows().length, 7);
});

test('动作失败保留状态、表单key、草稿保护，重试成功只增加一次版本', async () => {
  const page = fixture('?issue=demo-quality-001'); page.dirty(); page.failNext(); const before = page.form();
  await assert.rejects(page.save(), /填写内容已保留/); assert.equal(page.form().key, before.key); assert.equal(page.form().props.issue.version, 0); assert.equal(page.form().props.issue.status, 'unassigned');
  page.click('返回异常列表'); assert.equal(page.dialog().props.open, true); page.cancelDiscard(); assert.equal(page.form().key, before.key);
  await page.save(); assert.equal(page.form().props.issue.version, 1); assert.equal(page.form().props.issue.status, 'processing');
  page.click('返回异常列表'); assert.equal(page.dialog().props.open, false);
});

test('旧保存回调由当前模型版本拒绝，不能重复登记动作或覆盖新状态', async () => {
  const page = fixture('?issue=demo-quality-001'); const oldSave = page.form().props.onSubmit;
  await oldSave(actionInput('assign')); page.render();
  await assert.rejects(oldSave(actionInput('assign', { owner: '演示生产主管' })), /版本已变化/); page.render();
  assert.equal(page.form().props.issue.owner, '演示采购员'); assert.equal(page.form().props.issue.version, 1);
});

test('返回、切换操作、取消和重置均先保护脏草稿，取消后保留同一个表单', () => {
  const page = fixture('?issue=demo-quality-001'); page.dirty(); const key = page.form().key;
  for (const change of [() => page.click('返回异常列表'), () => page.action('feedback'), () => { page.form().props.onCancel(); page.render(); }, () => page.click('重置演示')]) {
    change(); assert.equal(page.dialog().props.open, true); assert.equal(page.form().key, key); page.cancelDiscard(); assert.equal(page.form().key, key);
  }
  page.action('feedback'); page.discard(); assert.equal(page.form().props.kind, 'feedback'); assert.notEqual(page.form().key, key);
  page.dirty(); page.click('重置演示'); page.discard(); assert.equal(page.params().get('issue'), null); assert.deepEqual(page.rowCodes(), ['DEMO-NC-001', 'DEMO-NC-002', 'DEMO-NC-003']);
});

test('路由后退和跳转由useBlocker保护，可取消或明确放弃继续，刷新保护同步清除', () => {
  const page = fixture('?issue=demo-quality-001'); assert.equal(page.beforeUnload().prevented, false);
  page.dirty(); assert.equal(page.beforeUnload().prevented, true);
  page.navigate(''); assert.equal(page.dialog().props.open, true); assert.equal(page.params().get('issue'), 'demo-quality-001');
  page.cancelDiscard(); assert.equal(page.params().get('issue'), 'demo-quality-001'); assert.equal(page.beforeUnload().prevented, true);
  page.navigate('?issue=demo-quality-002'); page.discard(); assert.equal(page.form().props.issue.id, 'demo-quality-002'); assert.equal(page.beforeUnload().prevented, false);
  page.dirty(); page.navigate('', '/__preview/receipt-disposition'); assert.equal(page.dialog().props.open, true);
  page.cancelDiscard(); assert.equal(page.location().pathname, '/__preview/quality-exceptions');
});

test('新建草稿也保护浏览器导航和刷新，取消保持弹窗，明确放弃关闭弹窗', () => {
  const page = fixture(); page.click('登记演示异常'); page.createDirty();
  assert.equal(page.beforeUnload().prevented, true); page.navigate('', '/__preview/receipt-disposition');
  assert.equal(page.dialog().props.open, true); assert.equal(page.create().props.open, true); assert.equal(page.create().props.navigationPending, true);
  page.cancelDiscard(); assert.equal(page.create().props.open, true); assert.equal(page.create().props.navigationPending, false); assert.equal(page.beforeUnload().prevented, true);
  page.navigate('?issue=demo-quality-001'); page.discard(); assert.equal(page.create().props.open, false); assert.equal(page.beforeUnload().prevented, false); assert.equal(page.form().props.issue.id, 'demo-quality-001');
});

test('新建草稿保存失败仍受导航保护，成功后清除脏标记并正常进入新详情', async () => {
  const page = fixture(); page.failNext(); page.click('登记演示异常'); page.createDirty();
  await assert.rejects(page.saveNew(), /填写内容已保留/); assert.equal(page.beforeUnload().prevented, true);
  page.navigate('?issue=demo-quality-001'); assert.equal(page.dialog().props.open, true); page.cancelDiscard();
  await page.saveNew(); assert.equal(page.dialog().props.open, false); assert.equal(page.beforeUnload().prevented, false); assert.equal(page.form().props.issue.code, 'DEMO-NC-007');
});

test('只读、空态、读取失败均隐藏动作，恢复后保存状态与历史仍在', async () => {
  for (const [scenario, message, restore] of [['仅可查看', '当前仅可查看', '返回正常操作'], ['暂无异常', '暂无质量异常', '返回演示异常'], ['读取失败', '质量异常读取失败', '重新加载']]) {
    const page = fixture('?issue=demo-quality-001'); await page.save(); page.dirty(); page.click(scenario);
    assert.equal(page.dialog().props.open, true); page.discard(); assert.equal(page.form(), undefined); assert.match(page.text(), new RegExp(message));
    assert.equal(page.nodes().find((node) => node.type === 'input' && node.props.type === 'checkbox').props.disabled, true);
    page.click(restore); assert.equal(page.form().props.issue.version, 1); assert.equal(page.form().props.issue.owner, '演示采购员'); assert.match(page.text(), /演示页面分派/);
  }
});

test('列表只读隐藏新建入口，未知详情链接可返回现有列表不误写其它单据', () => {
  const readonly = fixture(); readonly.click('仅可查看'); assert.equal(readonly.button('登记演示异常'), undefined); readonly.open('DEMO-NC-001'); assert.equal(readonly.form(), undefined); assert.match(readonly.text(), /当前仅可查看/);
  const unknown = fixture('?issue=demo-quality-missing'); assert.equal(unknown.form(), undefined); assert.match(unknown.text(), /未找到这张演示异常/);
  unknown.click('返回异常列表'); assert.equal(unknown.params().get('issue'), null); assert.deepEqual(unknown.rowCodes(), ['DEMO-NC-001', 'DEMO-NC-002', 'DEMO-NC-003']);
});

test('超过一页时分页可用，改变来源或查询后回第一页', async () => {
  const page = fixture();
  for (let index = 0; index < 3; index++) {
    page.click('登记演示异常'); await page.saveNew({ source: 'incoming', batchNo: `DEMO-PAGE-BATCH-${index}` }); page.click('返回异常列表');
  }
  page.source('all'); assert.equal(page.rows().length, 8); assert.match(page.text(), /第 1 \/ 2 页/); assert.equal(page.button('上一页').props.disabled, true);
  page.click('下一页'); assert.equal(page.rows().length, 1); assert.match(page.text(), /第 2 \/ 2 页/); assert.equal(page.button('下一页').props.disabled, true);
  page.input('quality-query', '演示页面新物料'); assert.equal(page.rows().length, 3); assert.match(page.text(), /第 1 \/ 1 页/);
});

test('页面和纯模型不访问接口、持久化或生产库存服务', async () => {
  assert.doesNotMatch(pageSource, /\b(?:fetch|XMLHttpRequest|WebSocket|localStorage|sessionStorage|indexedDB)\b/);
  const page = fixture('?issue=demo-quality-001'); await page.save(); page.click('读取失败'); page.click('重新加载'); page.click('重置演示');
  page.open('DEMO-NC-001'); assert.equal(page.form().props.issue.version, 0);
});

test('App生产开关关闭时不注册质量预览路由，也不创建质量预览懒加载', () => {
  const source = ts.createSourceFile('App.tsx', read('App.tsx'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let declaration, spread;
  function visit(node) {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === 'QualityExceptionsPreviewPage') declaration = node;
    if (ts.isSpreadElement(node) && node.getText(source).includes('/__preview/quality-exceptions')) spread = node;
    ts.forEachChild(node, visit);
  }
  visit(source); assert.ok(declaration); assert.ok(spread);
  const fragment = `const ${declaration.getText(source)}; export const routes = [${spread.getText(source)}];`.replaceAll('import.meta.env.DEV', '__DEV__');
  for (const development of [false, true]) {
    const exports = {}, loads = [];
    new Function('exports', 'require', '__DEV__', 'lazyNamed', 'lazyWrap', compile(fragment))(
      exports, (name) => { assert.equal(name, 'react/jsx-runtime'); return { jsx, jsxs: jsx }; }, development,
      (loader, name) => { loads.push({ loader, name }); return name; }, (element) => element,
    );
    assert.equal(loads.length, development ? 1 : 0); assert.deepEqual(exports.routes.map((route) => route.path), development ? ['/__preview/quality-exceptions'] : []);
  }
});
