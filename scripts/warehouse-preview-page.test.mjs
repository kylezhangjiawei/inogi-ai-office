import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

const read = (path) => readFileSync(new URL(`../src/app/${path}`, import.meta.url), 'utf8');
const compile = (source) => ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
const pageSource = read('procurement/warehouse/WarehousePreviewPage.tsx');
const jsx = (type, props, key) => ({ type, props: props ?? {}, key });
const primitives = new Proxy({}, { get: (_target, name) => name });
const translate = (value, params = {}) => value.replace(/\{(\w+)\}/g, (match, key) => params[key] ?? match);
const noExternalAccess = () => assert.fail('仓库预览不能访问接口或持久化存储');
const noStorage = new Proxy({}, { get: noExternalAccess, set: noExternalAccess });
class FixedDate extends Date {
  constructor(...args) { super(...(args.length ? args : ['2026-09-11T01:00:00.000Z'])); }
  static now() { return new Date('2026-09-11T01:00:00.000Z').getTime(); }
}
function evaluate(code, dependencies = {}, environment = {}) {
  const exports = {};
  new Function('exports', 'require', 'crypto', 'Date', 'fetch', 'localStorage', 'sessionStorage', 'indexedDB', 'window', 'document', code)(
    exports, (name) => { assert.ok(Object.hasOwn(dependencies, name), `未审查的页面依赖：${name}`); return dependencies[name]; },
    { randomUUID }, FixedDate, noExternalAccess, noStorage, noStorage, noStorage, environment.window ?? {}, {},
  );
  return exports;
}
const types = evaluate(compile(read('procurement/warehouse/warehouseTypes.ts')));
const model = evaluate(compile(read('procurement/warehouse/warehousePreviewModel.ts')), { './warehouseTypes': types });
const pageCode = compile(pageSource);
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
const actionInput = (context, patch = {}) => {
  const { state, kind, lotId, dispatchId, issueId, returnId, countId } = context;
  const lot = state.lots.find((row) => row.id === lotId);
  const issue = state.issues.find((row) => row.id === issueId);
  const returned = state.returns.find((row) => row.id === returnId);
  const count = state.counts.find((row) => row.id === countId);
  const dispatch = state.dispatches.find((row) => row.id === dispatchId);
  const issueLot = state.lots.find((row) => row.materialCode === dispatch?.materialCode && model.freeStock(row) > 0);
  return { ...{
    issue: { dispatchId, lotId: issueLot?.id, quantity: Math.min(1, model.freeStock(issueLot ?? state.lots[0]), (dispatch?.requiredQty ?? 0) - (dispatch?.issuedQty ?? 0)) },
    sign: { issueId, actualQty: issue?.quantity },
    return_create: { issueId, quantity: Math.min(1, issueId ? model.returnableQty(state, issueId) : 0), result: 'inspection', evidence: 'DEMO-PAGE-RETURN' },
    return_receive: { returnId, actualQty: returned?.quantity, result: returned?.result, reviewed: true, evidence: 'DEMO-PAGE-RECEIVE' },
    return_discrepancy: { returnId, actualQty: Math.max(0, (returned?.quantity ?? 1) - 1) },
    return_resubmit: { returnId, quantity: returned?.quantity },
    count_create: { lotId, bucket: 'qualified', actualQty: lot?.qualified, evidence: 'DEMO-PAGE-COUNT' },
    count_edit: { countId, actualQty: count?.actualQty, evidence: 'DEMO-PAGE-COUNT-EDIT' },
    count_submit: { countId }, count_approve: { countId }, count_reject: { countId },
  }[kind], kind, actor: kind === 'count_approve' || kind === 'count_reject' ? '演示复核人' : '演示仓管员', note: `演示页面 ${kind} 依据`, ...patch };
};

function fixture(initialSearch = '', seedTransform = (state) => state) {
  const slots = [], setters = [], effects = [], listeners = new Map();
  let cursor = 0, tree, blockerPredicate, pendingLocation;
  let location = { pathname: '/__preview/warehouse', search: initialSearch };
  const blocker = { state: 'unblocked', reset() { pendingLocation = undefined; blocker.state = 'unblocked'; }, proceed() { assert.ok(pendingLocation); location = pendingLocation; pendingLocation = undefined; blocker.state = 'unblocked'; } };
  const navigate = (next) => {
    if (blockerPredicate?.({ currentLocation: location, nextLocation: next })) { pendingLocation = next; blocker.state = 'blocked'; }
    else location = next;
  };
  const hooks = {
    useState(initial) { const index = cursor++; if (!(index in slots)) slots[index] = typeof initial === 'function' ? initial() : initial; setters[index] ??= (value) => { slots[index] = typeof value === 'function' ? value(slots[index]) : value; }; return [slots[index], setters[index]]; },
    useRef(initial) { const index = cursor++; return slots[index] ??= { current: initial }; },
    useCallback(callback, deps) { const index = cursor++, old = slots[index]; if (!old || deps.some((value, i) => !Object.is(value, old.deps[i]))) slots[index] = { callback, deps }; return slots[index].callback; },
    useEffect(effect, deps) { const index = cursor++, old = slots[index]; if (!old || deps.some((value, i) => !Object.is(value, old.deps[i]))) { slots[index] = { deps, cleanup: old?.cleanup }; effects.push(() => { slots[index].cleanup?.(); slots[index].cleanup = effect(); }); } },
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
    './WarehouseActionForm': { WarehouseActionForm: 'WarehouseActionForm' },
    './warehousePreviewModel': { ...model, createWarehouseState: () => seedTransform(model.createWarehouseState()) }, './warehouseTypes': types,
    '../../order-processing/horizon.css': {}, './warehouse-preview.css': {},
  };
  for (const component of ['alert-dialog', 'button', 'input', 'label', 'select']) dependencies[`../../components/ui/${component}`] = primitives;
  const exports = evaluate(pageCode, dependencies, { window: {
    addEventListener: (event, callback) => listeners.set(event, callback),
    removeEventListener: (event, callback) => { if (listeners.get(event) === callback) listeners.delete(event); },
  } });
  const view = {
    render() { cursor = 0; tree = exports.WarehousePreviewPage(); while (effects.length) effects.shift()(); return tree; },
    nodes() { return nodes(tree); }, text() { return normalized(tree); },
    byType(type) { return view.nodes().find((node) => node.type === type); },
    byId(id) { return view.nodes().find((node) => node.props.id === id); },
    form() { return view.byType('WarehouseActionForm'); }, context() { return view.form()?.props.context; },
    dialog() { return view.byType('AlertDialog'); },
    rows() { return view.nodes().filter((node) => (node.type === 'li' && String(node.props.className).split(' ').includes('whp-row')) || (node.type === 'tr' && String(node.props.className).split(' ').includes('whp-stock-row'))); },
    rowIds() { return view.rows().map((row) => row.key); },
    selectedRow() { return view.rows().find((node) => node.props.className.includes('is-selected'))?.key; },
    params() { return new URLSearchParams(location.search); }, location() { return { ...location }; },
    button(label) { return view.nodes().find((node) => ['Button', 'button', 'AlertDialogAction', 'AlertDialogCancel'].includes(node.type) && normalized(node) === label); },
    click(label) { const button = view.button(label); assert.ok(button, `${label} exists`); assert.equal(Boolean(button.props.disabled), false, `${label} enabled`); button.props.onClick(); return view.render(); },
    open(id) { const row = view.rows().find((node) => node.key === id); assert.ok(row, `${id} row exists`); nodes(row).find((node) => node.type === 'Button').props.onClick(); return view.render(); },
    tab(value) { return view.click(types.warehouseTabLabels[value]); },
    currentTab() { const group = view.nodes().find((node) => node.props.className === 'whp-tabs'); const current = nodes(group).find((node) => node.type === 'Button' && node.props['aria-current'] === 'page'); return Object.keys(types.warehouseTabLabels).find((key) => types.warehouseTabLabels[key] === normalized(current)); },
    input(id, value) { assert.ok(view.byId(id), `${id} exists`); view.byId(id).props.onChange({ target: { value } }); return view.render(); },
    select(id, value) { const select = view.nodes().find((node) => node.type === 'Select' && nodes(node).some((child) => child.props.id === id)); assert.ok(select, `${id} exists`); select.props.onValueChange(value); return view.render(); },
    selectedValue(id) { return view.nodes().find((node) => node.type === 'Select' && nodes(node).some((child) => child.props.id === id))?.props.value; },
    action(kind) { return view.select('whp-action', kind); },
    dirty(value = true) { assert.ok(view.form(), '有表单才产生草稿'); view.form().props.onDirtyChange(value); return view.render(); },
    cancelDiscard() { view.dialog().props.onOpenChange(false); return view.render(); },
    discard() { view.click('放弃并继续'); view.dialog().props.onOpenChange(false); return view.render(); },
    failNext(value = true) { view.nodes().find((node) => node.type === 'input' && node.props.type === 'checkbox').props.onChange({ target: { checked: value } }); return view.render(); },
    async save(patch = {}) { const form = view.form(); assert.ok(form, '当前有动作表单'); try { await form.props.onSubmit(actionInput(form.props.context, patch)); } finally { view.render(); } },
    navigate(search, pathname = location.pathname) { navigate({ pathname, search }); return view.render(); },
    beforeUnload() { const event = { prevented: false, returnValue: undefined, preventDefault() { this.prevented = true; } }; listeners.get('beforeunload')?.(event); return event; },
  };
  view.render(); return view;
}
const seed = () => model.createWarehouseState();
const eligibleDispatch = (state) => state.dispatches.find((row) => row.requiredQty !== null && row.requiredQty > row.issuedQty && state.lots.some((lot) => lot.materialCode === row.materialCode && model.freeStock(lot) > 0));
const issuePage = () => { const dispatch = eligibleDispatch(seed()); assert.ok(dispatch, '种子有可发料的派工'); return fixture(`?tab=issues&selected=${dispatch.id}`); };

test('默认库存选中首批次，显示独立演示与数量边界，未知页签安全回到库存', () => {
  const page = fixture(); assert.equal(page.currentTab(), 'inventory'); assert.equal(page.selectedRow(), seed().lots[0].id); assert.equal(page.form(), undefined);
  assert.match(page.text(), /使用独立演示库存，刷新后恢复/); assert.match(page.text(), /不影响正式库存、齐套或 ERP/); assert.match(page.text(), /可用 = 合格现存 − 已占用/);
  assert.equal(fixture('?tab=unknown').currentTab(), 'inventory');
});

test('库存表按批次区分同名物料，按钮名称唯一且选择后详情和新盘点保持同一批次', () => {
  const state = seed(), first = state.lots[0], second = state.lots.find((lot) => lot.materialName === first.materialName && lot.batchNo !== first.batchNo); assert.ok(second);
  const page = fixture(), table = page.byType('table'); assert.ok(table, '库存使用语义表格');
  assert.equal(normalized(nodes(table).find((node) => node.type === 'caption')), '按批次查看库存状态数量');
  assert.deepEqual(nodes(table).filter((node) => node.type === 'th').map(normalized), ['物料 / 批次', '合格', '占用', '可用', '待检', '不良', '冻结', '操作']);
  const rowButtons = page.rows().map((row) => nodes(row).find((node) => node.type === 'Button'));
  const names = rowButtons.map((button) => button.props['aria-label']); assert.equal(new Set(names).size, names.length);
  assert.ok(names.includes(`查看记录 ${first.materialName} · ${first.batchNo}`)); assert.ok(names.includes(`查看记录 ${second.materialName} · ${second.batchNo}`));
  rowButtons.find((button) => button.props['aria-label'] === `查看记录 ${second.materialName} · ${second.batchNo}`).props.onClick(); page.render();
  assert.equal(page.params().get('selected'), second.id); assert.equal(page.selectedRow(), second.id);
  const row = page.rows().find((item) => item.key === second.id); assert.equal(nodes(row).find((node) => node.props['data-label'] === '可用').props.children, model.freeStock(second).toLocaleString('zh-CN'));
  page.click('发起盘点'); assert.equal(page.context().lotId, second.id); assert.equal(page.context().state.lots.find((lot) => lot.id === second.id).batchNo, second.batchNo);
});

test('页签各自保留搜索和状态筛选，清除筛选只作用当前页签', () => {
  const state = seed(), first = state.lots[0], page = fixture();
  page.input('whp-search', first.batchNo); page.select('whp-status', 'qualified'); page.select('whp-warehouse', first.warehouse);
  assert.ok(page.rowIds().includes(first.id)); page.tab('issues'); page.input('whp-search', state.dispatches[0].dispatchNo); page.select('whp-status', 'dispatch');
  assert.ok(page.rowIds().includes(state.dispatches[0].id)); page.tab('inventory');
  assert.equal(page.byId('whp-search').props.value, first.batchNo); assert.equal(page.selectedValue('whp-status'), 'qualified'); assert.equal(page.selectedValue('whp-warehouse'), first.warehouse);
  page.click('清除筛选'); page.tab('issues'); assert.equal(page.byId('whp-search').props.value, state.dispatches[0].dispatchNo); assert.equal(page.selectedValue('whp-status'), 'dispatch');
});

test('搜索零匹配显示可恢复空态，不能继续编辑之前选中的记录', () => {
  const page = issuePage(); assert.ok(page.form()); page.input('whp-search', '不存在的仓库记录');
  assert.equal(page.rows().length, 0); assert.equal(page.form(), undefined); assert.equal(page.params().get('selected'), null); assert.match(page.text(), /没有匹配的记录/);
  page.click('清除当前筛选'); assert.ok(page.rows().length); assert.ok(page.form());
});

test('分页以八条为界，翻页默认选当前页首项，搜索后回第一页', () => {
  const page = fixture('', (state) => ({ ...state, lots: Array.from({ length: 10 }, (_, index) => ({ ...state.lots[0], id: `page-lot-${index}`, batchNo: `PAGE-BATCH-${index}`, materialName: `分页物料 ${index}` })) }));
  assert.equal(page.rows().length, 8); assert.equal(page.selectedRow(), 'page-lot-0'); assert.equal(page.button('上一页').props.disabled, true);
  page.click('下一页'); assert.deepEqual(page.rowIds(), ['page-lot-8', 'page-lot-9']); assert.equal(page.selectedRow(), 'page-lot-8'); assert.equal(page.button('下一页').props.disabled, true);
  page.tab('counts'); page.tab('inventory'); assert.deepEqual(page.rowIds(), ['page-lot-8', 'page-lot-9']);
  page.input('whp-search', 'PAGE-BATCH-1'); assert.deepEqual(page.rowIds(), ['page-lot-1']); assert.match(page.text(), /第 1 \/ 1 页/);
});

test('发料保存后选中新领料记录，签收不重复扣仓库，相关详情指向同一批次', async () => {
  const page = issuePage(), original = page.context().state, input = actionInput(page.context()), lot = original.lots.find((row) => row.id === input.lotId);
  await page.save(); const afterIssue = page.context(); assert.equal(afterIssue.kind, 'sign'); assert.equal(page.params().get('selected'), afterIssue.issueId);
  const issued = afterIssue.state.issues.find((row) => row.id === afterIssue.issueId); assert.equal(issued.quantity, input.quantity); assert.equal(afterIssue.lotId, lot.id);
  assert.equal(afterIssue.state.lots.find((row) => row.id === lot.id).qualified, lot.qualified - input.quantity);
  await page.save(); assert.equal(page.form(), undefined); assert.match(page.text(), /领料已签收/); assert.match(page.text(), /已保存生产签收演示记录/);
  page.click('从此领料登记退料'); assert.equal(page.currentTab(), 'returns'); assert.equal(page.context().issueId, issued.id);
  assert.equal(page.context().state.lots.find((row) => row.id === lot.id).qualified, lot.qualified - input.quantity);
});

test('生产退料保存到实际新单，待检接收只增加待检并同步线边与处理历史', async () => {
  const state = seed(), signed = state.issues.find((row) => row.status === 'signed' && model.returnableQty(state, row.id) > 0); assert.ok(signed);
  const page = fixture(`?tab=returns&selected=new-return--${signed.id}`), before = page.context().state, lot = before.lots.find((row) => row.id === signed.lotId), input = actionInput(page.context());
  await page.save(); assert.equal(page.context().kind, 'return_receive'); const returnId = page.context().returnId;
  assert.equal(page.params().get('selected'), returnId); assert.equal(page.context().state.lots.find((row) => row.id === lot.id).inspection, lot.inspection);
  await page.save(); assert.equal(page.form(), undefined); assert.match(page.text(), /退料已接收/); assert.match(page.text(), /演示页面 return_receive 依据/);
  page.click('查看本批库存'); page.click('发起盘点'); const after = page.context().state;
  assert.equal(after.lots.find((row) => row.id === lot.id).qualified, lot.qualified); assert.equal(after.lots.find((row) => row.id === lot.id).inspection, lot.inspection + input.quantity);
  assert.equal(model.lineBalance(after.issues.find((row) => row.id === signed.id)), model.lineBalance(signed) - input.quantity);
});

test('盘点新建与提交不改库存，复核后才更新并关闭可编辑动作', async () => {
  const state = seed(), lot = state.lots.find((row) => row.qualified - row.reserved >= 1); assert.ok(lot);
  const page = fixture(`?tab=inventory&selected=${lot.id}`); page.click('发起盘点'); assert.equal(page.context().kind, 'count_create'); assert.equal(page.context().lotId, lot.id);
  await page.save({ actualQty: lot.qualified - 1 }); assert.equal(page.context().kind, 'count_submit'); const countId = page.context().countId;
  assert.equal(page.params().get('selected'), countId); assert.equal(page.context().state.lots.find((row) => row.id === lot.id).qualified, lot.qualified);
  await page.save(); assert.equal(page.context().kind, 'count_approve'); assert.equal(page.context().state.lots.find((row) => row.id === lot.id).qualified, lot.qualified);
  await page.save(); assert.equal(page.form(), undefined); assert.match(page.text(), /盘点已复核调整/);
  page.click('查看本批库存'); page.click('发起盘点'); assert.equal(page.context().state.lots.find((row) => row.id === lot.id).qualified, lot.qualified - 1);
  assert.equal(page.context().state.movements.filter((row) => row.kind === 'adjustment' && row.documentNo === page.context().state.counts.find((row) => row.id === countId).code).length, 1);
});

test('合格实盘低于占用量保留真实草稿，提交失败不改库存，核对修改后才可继续', async () => {
  const lot = seed().lots.find((row) => row.reserved > 0); assert.ok(lot);
  const page = fixture(`?tab=counts&selected=new-count--${lot.id}`), actual = lot.reserved - 1;
  await page.save({ actualQty: actual }); const saved = page.context().state, countId = page.context().countId;
  assert.equal(saved.counts.find((row) => row.id === countId).actualQty, actual); assert.equal(saved.lots.find((row) => row.id === lot.id).qualified, lot.qualified);
  page.dirty(); const key = page.form().key; await assert.rejects(page.save(), /实盘合格数量不能低于预留数量/);
  assert.equal(page.context().state, saved); assert.equal(page.form().key, key); assert.equal(page.beforeUnload().prevented, true);
  assert.equal(page.context().state.counts.find((row) => row.id === countId).status, 'draft');
  assert.equal(page.context().state.movements.filter((row) => row.kind === 'adjustment').length, saved.movements.filter((row) => row.kind === 'adjustment').length);
  page.action('count_edit'); page.discard(); await page.save({ actualQty: lot.reserved }); await page.save(); assert.equal(page.context().kind, 'count_approve');
  await page.save(); page.click('查看本批库存'); page.click('发起盘点');
  const adjusted = page.context().state.lots.find((row) => row.id === lot.id); assert.equal(adjusted.qualified, lot.reserved); assert.equal(model.freeStock(adjusted), 0);
});

test('新退料原单和新盘点批次可切换，草稿期间必须确认且取消保留上下文', () => {
  const state = seed(), choices = state.issues.filter((row) => row.status === 'signed' && model.returnableQty(state, row.id) > 0); assert.ok(choices.length);
  const page = fixture(`?tab=returns&selected=new-return--${choices[0].id}`); assert.equal(page.selectedValue('whp-new-return-source'), choices[0].id);
  const countPage = fixture(`?tab=counts&selected=new-count--${state.lots[0].id}`); countPage.dirty(); const key = countPage.form().key;
  countPage.select('whp-new-count-source', state.lots[1].id); assert.equal(countPage.dialog().props.open, true); countPage.cancelDiscard(); assert.equal(countPage.form().key, key);
  countPage.select('whp-new-count-source', state.lots[1].id); countPage.discard(); assert.equal(countPage.context().lotId, state.lots[1].id); assert.equal(countPage.beforeUnload().prevented, false);
});

test('退料差异退回后提供更正动作，重新提交仍不扣线边，接收完成后才记账', async () => {
  const state = seed(), returned = state.returns.find((row) => row.status === 'pending' && row.quantity > 1); assert.ok(returned);
  const page = fixture(`?tab=returns&selected=${returned.id}`), original = page.context().state;
  page.action('return_discrepancy'); await page.save({ actualQty: returned.quantity - 1 });
  assert.equal(page.context().kind, 'return_resubmit'); assert.equal(page.context().state.returns.find((row) => row.id === returned.id).status, 'discrepancy');
  assert.deepEqual(page.context().state.lots, original.lots); assert.deepEqual(page.context().state.issues, original.issues);
  await page.save({ quantity: returned.quantity - 1 }); assert.equal(page.context().kind, 'return_receive');
  assert.deepEqual(page.context().state.lots, original.lots); assert.deepEqual(page.context().state.issues, original.issues);
  await page.save(); assert.equal(page.form(), undefined); assert.match(page.text(), /退料已接收/); assert.match(page.text(), /演示页面 return_resubmit 依据/);
});

test('盘点复核退回可修改再提交，切换复核动作先保护当前草稿', async () => {
  const state = seed(), lot = state.lots[0], page = fixture(`?tab=counts&selected=new-count--${lot.id}`);
  await page.save(); await page.save(); assert.equal(page.context().kind, 'count_approve');
  page.dirty(); const key = page.form().key; page.action('count_reject'); assert.equal(page.dialog().props.open, true); page.cancelDiscard(); assert.equal(page.form().key, key);
  page.action('count_reject'); page.discard(); await page.save(); assert.equal(page.context().kind, 'count_edit');
  const countId = page.context().countId; assert.equal(page.context().state.counts.find((row) => row.id === countId).status, 'rejected');
  await page.save(); assert.equal(page.context().kind, 'count_submit'); await page.save(); assert.equal(page.context().kind, 'count_approve');
  assert.equal(page.context().state.lots.find((row) => row.id === lot.id).qualified, lot.qualified); assert.match(page.text(), /演示页面 count_reject 依据/);
});

test('只读模式保留库存与历史查询，隐藏库存盘点、退料和盘点新建入口', () => {
  const page = fixture(); page.click('仅可查看'); assert.equal(page.button('发起盘点'), undefined);
  page.tab('returns'); assert.equal(page.button('登记退料'), undefined); assert.equal(page.form(), undefined);
  page.tab('counts'); assert.equal(page.button('新建盘点'), undefined); assert.equal(page.form(), undefined); assert.match(page.text(), /当前仅可查看记录/);
});

test('切换页签、搜索、取消与重置都保护草稿，明确放弃后才改变页面', () => {
  const page = issuePage(); page.dirty(); const key = page.form().key;
  for (const change of [() => page.tab('inventory'), () => page.input('whp-search', '待查'), () => { page.form().props.onCancel(); page.render(); }, () => page.click('重置演示')]) {
    change(); assert.equal(page.dialog().props.open, true); assert.equal(page.form().key, key); page.cancelDiscard(); assert.equal(page.form().key, key);
  }
  page.tab('inventory'); page.discard(); assert.equal(page.currentTab(), 'inventory'); assert.equal(page.beforeUnload().prevented, false);
});

test('路由返回、跨页面导航与刷新受草稿保护，取消保留原记录，放弃使用目标上下文', () => {
  const page = issuePage(), initial = page.params().get('selected'); page.dirty(); assert.equal(page.beforeUnload().prevented, true);
  page.navigate('?tab=inventory'); assert.equal(page.dialog().props.open, true); assert.equal(page.params().get('selected'), initial); page.cancelDiscard(); assert.equal(page.beforeUnload().prevented, true);
  page.navigate('?tab=inventory'); page.discard(); assert.equal(page.currentTab(), 'inventory'); assert.equal(page.beforeUnload().prevented, false);
  page.click('发起盘点'); page.dirty(); page.navigate('', '/__preview/quality-exceptions'); assert.equal(page.dialog().props.open, true); page.cancelDiscard(); assert.equal(page.location().pathname, '/__preview/warehouse');
});

test('保存失败不生成记录或丢弃草稿，重试仅保存一次且清除导航保护', async () => {
  const page = issuePage(); page.dirty(); page.failNext(); const before = page.context().state, key = page.form().key;
  await assert.rejects(page.save(), /填写内容已保留/); assert.equal(page.context().state, before); assert.equal(page.form().key, key); assert.equal(page.beforeUnload().prevented, true);
  assert.equal(page.nodes().find((node) => node.type === 'input' && node.props.type === 'checkbox').props.checked, false);
  await page.save(); assert.equal(page.context().state.issues.length, before.issues.length + 1); assert.equal(page.context().state.version, before.version + 1); assert.equal(page.beforeUnload().prevented, false);
});

test('旧版本保存回调不能再次扣库或生成第二张领料单', async () => {
  const page = issuePage(), oldSave = page.form().props.onSubmit, input = actionInput(page.context());
  await oldSave(input); page.render(); const state = page.context().state;
  await assert.rejects(oldSave(input), /版本|变化|更新/); page.render(); assert.equal(page.context().state, state);
});

test('只读、空态和读取失败隐藏保存动作，恢复后保留已保存记录', async () => {
  for (const [scenario, message, restore] of [['仅可查看', '当前仅可查看记录', '正常操作'], ['暂无数据', '暂无仓库记录', '返回演示数据'], ['读取失败', '仓库记录读取失败', '重新加载']]) {
    const page = issuePage(); await page.save(); const id = page.context().issueId; page.dirty(); page.click(scenario); assert.equal(page.dialog().props.open, true); page.discard();
    assert.equal(page.form(), undefined); assert.match(page.text(), new RegExp(message)); assert.equal(page.nodes().find((node) => node.type === 'input' && node.props.type === 'checkbox').props.disabled, true);
    page.click(restore); assert.equal(page.context().issueId, id); assert.equal(page.context().kind, 'sign'); assert.match(page.text(), /演示页面 issue 依据/);
  }
});

test('未知或跨类型id不套用其他记录，恢复链接重新选择有效上下文', () => {
  const state = seed();
  for (const search of ['?tab=returns&selected=missing', `?tab=counts&selected=new-count--missing`, `?tab=issues&selected=${state.lots[0].id}`]) {
    const page = fixture(search); assert.equal(page.form(), undefined); assert.match(page.text(), /未找到这条演示记录/); page.click('返回现有记录'); assert.equal(page.params().get('selected'), null);
  }
});

test('页面和模型在新增、失败恢复与重置期间不访问接口或存储', async () => {
  assert.doesNotMatch(pageSource, /\b(?:fetch|XMLHttpRequest|WebSocket|localStorage|sessionStorage|indexedDB)\b/);
  const page = issuePage(); await page.save(); page.click('读取失败'); page.click('重新加载'); page.click('重置演示');
  assert.equal(page.currentTab(), 'inventory'); assert.equal(page.selectedRow(), seed().lots[0].id);
});

test('生产开关关闭时不注册仓库预览路由，也不创建其懒加载', () => {
  const source = ts.createSourceFile('App.tsx', read('App.tsx'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let declaration, spread;
  function visit(node) {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === 'WarehousePreviewPage') declaration = node;
    if (ts.isSpreadElement(node) && node.getText(source).includes('/__preview/warehouse')) spread = node;
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
    assert.equal(loads.length, development ? 1 : 0); assert.deepEqual(exports.routes.map((route) => route.path), development ? ['/__preview/warehouse'] : []);
  }
});
