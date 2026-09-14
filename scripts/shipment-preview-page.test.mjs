import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

const read = (path) => readFileSync(new URL(`../src/app/${path}`, import.meta.url), 'utf8');
const compile = (source) => ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
const pageSource = read('procurement/shipments/ShipmentPreviewPage.tsx');
const jsx = (type, props, key) => ({ type, props: props ?? {}, key });
const primitives = new Proxy({}, { get: (_target, name) => name });
const translate = (value, params = {}) => value.replace(/\{(\w+)\}/g, (match, key) => params[key] ?? match);
const noExternalAccess = () => assert.fail('出货预览不能访问业务接口或持久化存储');
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
const types = evaluate(compile(read('procurement/shipments/shipmentTypes.ts')));
const model = evaluate(compile(read('procurement/shipments/shipmentPreviewModel.ts')), { './shipmentTypes': types });
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
function actionInput(context, patch = {}) {
  const { state, kind, recordId } = context;
  const record = state.records.find((row) => row.id === recordId);
  const draft = {
    documentNo: 'SHIP-PAGE-NEW', actualDate: '2026-09-09', customer: '页面演示客户', orderNo: 'SO-PAGE-NEW',
    batchId: model.shipmentSeedIds.secondBatch, quantity: 10, handler: '演示仓管', note: '页面登记演示', serialNumbers: [],
  };
  return {
    ...({ create: draft, edit: { ...record, reason: '更正登记依据' }, confirm: {}, reverse: { reason: '原登记日期核对更正', createReplacement: false }, sn: { reason: '补录现有 SN 清单', serialNumbers: ['PAGE-SN-001'] } }[kind]),
    kind, actor: '演示仓管', ...(recordId ? { recordId } : {}), ...patch,
  };
}

function fixture(initialSearch = '', seedTransform = (state) => state) {
  const slots = [], setters = [], effects = [], listeners = new Map();
  let cursor = 0, tree, blockerPredicate, pendingLocation;
  let location = { pathname: '/__preview/shipments', search: initialSearch };
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
    './ShipmentActionForm': { ShipmentActionForm: 'ShipmentActionForm' },
    './shipmentPreviewModel': { ...model, createShipmentState: () => seedTransform(model.createShipmentState()) }, './shipmentTypes': types,
    '../../order-processing/horizon.css': {}, './shipment-preview.css': {},
  };
  for (const component of ['alert-dialog', 'button', 'input', 'label', 'select', 'sheet']) dependencies[`../../components/ui/${component}`] = primitives;
  const exports = evaluate(pageCode, dependencies, { window: {
    addEventListener: (event, callback) => listeners.set(event, callback),
    removeEventListener: (event, callback) => { if (listeners.get(event) === callback) listeners.delete(event); },
  } });
  const view = {
    render() { cursor = 0; tree = exports.ShipmentPreviewPage(); while (effects.length) effects.shift()(); return tree; },
    nodes() { return nodes(tree); }, text() { return normalized(tree); },
    byType(type) { return view.nodes().find((node) => node.type === type); },
    byId(id) { return view.nodes().find((node) => node.props.id === id); },
    form() { return view.byType('ShipmentActionForm'); }, context() { return view.form()?.props.context; },
    state() { return slots.find((value) => value && Array.isArray(value.records) && Array.isArray(value.batches)); },
    dialog() { return view.nodes().find((node) => node.type === 'AlertDialog' && /放弃尚未保存/.test(normalized(node))); },
    sheet() { return view.byType('Sheet'); },
    rows() { return nodes(view.byType('tbody')).filter((node) => node.type === 'tr'); }, rowIds() { return view.rows().map((row) => row.key); },
    selectedRow() { return view.rows().find((row) => row.props.className.includes('is-selected'))?.key; },
    params() { return new URLSearchParams(location.search); }, location() { return { ...location }; },
    button(label) { return view.nodes().find((node) => ['Button', 'button', 'AlertDialogAction', 'AlertDialogCancel'].includes(node.type) && (node.props['aria-label'] === label || normalized(node) === label)); },
    click(label) { const button = view.button(label); assert.ok(button, `${label} exists`); assert.equal(Boolean(button.props.disabled), false, `${label} enabled`); button.props.onClick(); return view.render(); },
    open(id) { const row = view.rows().find((node) => node.key === id); assert.ok(row, `${id} row exists`); nodes(row).find((node) => node.type === 'Button').props.onClick(); return view.render(); },
    input(id, value) { assert.ok(view.byId(id), `${id} exists`); view.byId(id).props.onChange({ target: { value } }); return view.render(); },
    select(id, value) { const select = view.nodes().find((node) => node.type === 'Select' && nodes(node).some((child) => child.props.id === id)); assert.ok(select, `${id} exists`); select.props.onValueChange(value); return view.render(); },
    selectedValue(id) { return view.nodes().find((node) => node.type === 'Select' && nodes(node).some((child) => child.props.id === id))?.props.value; },
    dirty(value = true) { assert.ok(view.form(), '有表单才产生草稿'); view.form().props.onDirtyChange(value); return view.render(); },
    cancelDiscard() { view.dialog().props.onOpenChange(false); return view.render(); },
    discard() { view.click('放弃并继续'); view.dialog().props.onOpenChange(false); return view.render(); },
    failNext(value = true) { view.nodes().find((node) => node.type === 'input' && node.props.type === 'checkbox').props.onChange({ target: { checked: value } }); return view.render(); },
    async save(patch = {}) { const form = view.form(); assert.ok(form, '当前有动作表单'); try { await form.props.onSubmit(actionInput(form.props.context, patch)); } finally { view.render(); } },
    navigate(search, pathname = location.pathname) { navigate({ pathname, search }); return view.render(); },
    beforeUnload() { const event = { prevented: false, returnValue: undefined, preventDefault() { this.prevented = true; } }; listeners.get('beforeunload')?.(event); return event; },
    metric(label) { const container = view.nodes().find((node) => node.type === 'dl' && node.props.className === 'shp-metrics'); const pair = nodes(container).find((node) => node.type === 'div' && normalized(node.props.children?.[0]) === label); return normalized(pair?.props.children?.[1]); },
    archiveRows() { const list = nodes(view.sheet()).find((node) => node.props.className === 'shp-archive-records'); return nodes(list).filter((node) => node.type === 'li' && node.key && view.state().records.some((row) => row.id === node.key)); },
  };
  view.render(); return view;
}
const seed = () => model.createShipmentState();
const ids = model.shipmentSeedIds;
const draftPage = () => fixture(`?month=2026-09&selected=${ids.draftShipment}`);

test('默认月份显示 A18 基准、独立演示边界及可区分的出库单按钮', () => {
  const page = fixture(); assert.equal(page.selectedRow(), ids.secondShipment); assert.equal(page.form(), undefined);
  assert.equal(page.metric('本月实际出货'), '180 台'); assert.equal(page.metric('本月整机完工'), '216 台'); assert.equal(page.metric('距目标待出货'), '820 台');
  assert.match(page.text(), /实际库存、月度目标和正式批次档案尚未联动/);
  const buttons = page.rows().map((row) => nodes(row).find((node) => node.type === 'Button').props['aria-label']);
  assert.equal(new Set(buttons).size, 3); assert.ok(buttons.includes('查看出库单 SHIP-0909-01'));
});

test('确认待出库 20 台后出货变为 200，完工保持 216，重复旧回调不重复记账', async () => {
  const page = draftPage(); page.click('确认实际出库'); const oldSave = page.form().props.onSubmit, input = actionInput(page.context());
  await oldSave(input); page.render(); assert.equal(page.form(), undefined); assert.equal(page.params().get('selected'), ids.draftShipment);
  assert.equal(page.metric('本月实际出货'), '200 台'); assert.equal(page.metric('本月整机完工'), '216 台'); assert.equal(page.metric('距目标待出货'), '800 台');
  assert.equal(page.button('确认实际出库'), undefined); assert.ok(page.button('冲销 / 更正')); const state = page.state();
  await assert.rejects(oldSave(input), /变化|重复|确认/); page.render(); assert.equal(page.state(), state); assert.equal(page.metric('本月实际出货'), '200 台');
});

test('分批登记选中新草稿且清除筛选，草稿不计入实际出货', async () => {
  const page = fixture(); page.select('shp-status', 'confirmed'); page.input('shp-query', 'SO-0902'); page.click('登记出货');
  const before = page.state(); await page.save(); const created = page.state().records.find((row) => !before.records.some((old) => old.id === row.id));
  assert.equal(created.status, 'draft'); assert.equal(page.params().get('selected'), created.id); assert.equal(page.selectedRow(), created.id);
  assert.equal(page.selectedValue('shp-status'), 'all'); assert.equal(page.byId('shp-query').props.value, ''); assert.equal(page.metric('本月实际出货'), '180 台');
});

test('保存失败保留同一表单与草稿保护，状态不变，重试只产生一次记录', async () => {
  const page = fixture(); page.click('登记出货'); page.dirty(); page.failNext(); const before = page.state(), key = page.form().key;
  await assert.rejects(page.save(), /填写内容已保留/); assert.equal(page.state(), before); assert.equal(page.form().key, key); assert.equal(page.beforeUnload().prevented, true);
  assert.equal(page.nodes().find((node) => node.type === 'input' && node.props.type === 'checkbox').props.checked, false);
  await page.save(); assert.equal(page.state().records.length, before.records.length + 1); assert.equal(page.state().version, before.version + 1); assert.equal(page.beforeUnload().prevented, false);
});

test('未保存切换记录先确认，取消保持原表单，放弃后选中目标', () => {
  const page = draftPage(); page.click('修改登记'); page.dirty(); const formKey = page.form().key;
  page.open(ids.firstShipment); assert.equal(page.dialog().props.open, true); assert.equal(page.params().get('selected'), ids.draftShipment); assert.equal(page.form().key, formKey);
  page.cancelDiscard(); assert.equal(page.dialog().props.open, false); assert.equal(page.beforeUnload().prevented, true);
  page.open(ids.firstShipment); page.discard(); assert.equal(page.selectedRow(), ids.firstShipment); assert.equal(page.form(), undefined); assert.equal(page.beforeUnload().prevented, false);
});

test('搜索、状态和月份切换均保护草稿，放弃后应用对应筛选', () => {
  for (const [change, verify] of [
    [(page) => page.input('shp-query', 'SO-0901'), (page) => { assert.equal(page.byId('shp-query').props.value, 'SO-0901'); assert.deepEqual(page.rowIds(), [ids.firstShipment]); }],
    [(page) => page.select('shp-status', 'confirmed'), (page) => { assert.equal(page.selectedValue('shp-status'), 'confirmed'); assert.equal(page.rows().length, 2); }],
    [(page) => page.input('shp-month', '2026-08'), (page) => { assert.equal(page.params().get('month'), '2026-08'); assert.equal(page.rows().length, 0); }],
  ]) {
    const page = draftPage(); page.click('修改登记'); page.dirty(); change(page); assert.equal(page.dialog().props.open, true); assert.equal(page.params().get('selected'), ids.draftShipment);
    page.discard(); assert.equal(page.form(), undefined); verify(page);
  }
});

test('路由离开与刷新受草稿保护，取消留在原页，放弃继续目标页面', () => {
  const page = draftPage(); page.click('修改登记'); page.dirty(); assert.equal(page.beforeUnload().prevented, true);
  page.navigate('', '/__preview/warehouse'); assert.equal(page.dialog().props.open, true); assert.equal(page.location().pathname, '/__preview/shipments');
  page.cancelDiscard(); assert.equal(page.beforeUnload().prevented, true); page.navigate('', '/__preview/warehouse'); page.discard();
  assert.equal(page.location().pathname, '/__preview/warehouse'); assert.equal(page.beforeUnload().prevented, false);
});

test('未知记录 URL 显示恢复提示，返回现有记录不套用错误上下文', () => {
  const page = fixture('?month=2026-09&selected=missing'); assert.equal(page.selectedRow(), undefined); assert.equal(page.form(), undefined);
  assert.match(page.text(), /未找到这条演示记录/); page.click('返回现有记录'); assert.equal(page.params().get('selected'), null); assert.equal(page.selectedRow(), ids.secondShipment);
  const invalidMonth = fixture('?month=not-a-month'); assert.equal(invalidMonth.byId('shp-month').props.value, '2026-09');
});

test('没有匹配结果时不显示旧记录操作，清除筛选恢复', () => {
  const page = fixture(); page.input('shp-query', '不存在的客户订单'); assert.equal(page.rows().length, 0); assert.equal(page.button('补充 SN'), undefined);
  assert.equal(page.button('冲销 / 更正'), undefined); assert.match(page.text(), /没有匹配的出货记录/); page.click('清除筛选'); assert.equal(page.rows().length, 3); assert.ok(page.button('补充 SN'));
});

test('冲销更正保留原单并选中新草稿，重新确认才恢复出货量', async () => {
  const page = fixture(); page.click('冲销 / 更正'); await page.save({ createReplacement: true });
  const original = page.state().records.find((row) => row.id === ids.secondShipment); const replacement = page.state().records.find((row) => row.replacementFor === original.id);
  assert.equal(original.status, 'reversed'); assert.equal(replacement.status, 'draft'); assert.notEqual(replacement.documentNo, original.documentNo);
  assert.equal(page.params().get('selected'), replacement.id); assert.equal(page.selectedRow(), replacement.id); assert.equal(page.metric('本月实际出货'), '100 台');
  assert.match(page.text(), /原记录已冲销，更正草稿已生成/); assert.match(page.text(), /更正来源.*SHIP-0908-01/);
  page.click('确认实际出库'); await page.save(); assert.equal(page.metric('本月实际出货'), '180 台'); assert.equal(page.metric('本月整机完工'), '216 台');
});

test('只冲销后原单留档且无写操作，归属原月份的有效出货减少', async () => {
  const page = fixture(); page.click('冲销 / 更正'); await page.save(); assert.equal(page.params().get('selected'), ids.secondShipment);
  assert.equal(page.metric('本月实际出货'), '100 台'); assert.match(page.text(), /原记录保留备查，不再计入有效出货/);
  assert.equal(page.button('冲销 / 更正'), undefined); assert.equal(page.button('修改登记'), undefined); assert.equal(page.button('确认实际出库'), undefined);
  assert.ok(page.state().history.some((item) => item.recordId === ids.secondShipment && item.kind === 'reverse' && item.before.status === 'confirmed' && item.after.status === 'reversed'));
});

test('草稿修改实际日期后跳到记录所属月份，终检和放行不足不误计出货', async () => {
  const page = draftPage(); page.click('修改登记'); await page.save({ actualDate: '2026-08-31', batchId: ids.unreleasedBatch });
  assert.equal(page.params().get('month'), '2026-08'); assert.equal(page.selectedRow(), ids.draftShipment); assert.equal(page.metric('本月实际出货'), '0 台');
  page.click('确认实际出库'); const before = page.state(); await assert.rejects(page.save(), /放行/); assert.equal(page.state(), before); assert.equal(page.metric('本月实际出货'), '0 台');
});

test('补充 SN 更新同一单据及查询，出货数量和完工量不变', async () => {
  const page = fixture(); page.click('补充 SN'); await page.save(); assert.equal(page.metric('本月实际出货'), '180 台'); assert.equal(page.metric('本月整机完工'), '216 台');
  assert.match(page.text(), /PAGE-SN-001/); assert.match(page.text(), /待补齐 79 台/); page.input('shp-query', 'PAGE-SN-001'); assert.deepEqual(page.rowIds(), [ids.secondShipment]);
});

test('档案引用当前状态中的本批单据、冲销及 SN，点击原单返回对应记录', async () => {
  const page = fixture(); page.click('冲销 / 更正'); await page.save({ createReplacement: true }); const replacementId = page.params().get('selected');
  page.click('查看批次档案'); assert.equal(page.sheet().props.open, true); const archiveRows = page.archiveRows();
  const expected = page.state().records.filter((row) => row.batchId === ids.secondBatch); assert.deepEqual(archiveRows.map((row) => row.key), expected.map((row) => row.id));
  assert.ok(archiveRows.some((row) => row.key === replacementId)); assert.ok(!archiveRows.some((row) => row.key === ids.firstShipment));
  assert.match(normalized(page.sheet()), /终检依据.*FQC-0907-02/); assert.match(normalized(page.sheet()), /质量授权放行/);
  const original = archiveRows.find((row) => row.key === ids.secondShipment); assert.match(normalized(original), /已冲销/);
  nodes(original).find((node) => node.type === 'Button').props.onClick(); page.render(); assert.equal(page.sheet().props.open, false); assert.equal(page.params().get('selected'), ids.secondShipment);
});

test('只读隐藏动作且禁用登记和失败开关，恢复正常保留已保存记录', async () => {
  const page = draftPage(); page.click('确认实际出库'); await page.save(); const state = page.state(); page.click('只读');
  assert.equal(page.form(), undefined); assert.equal(page.button('登记出货').props.disabled, true); assert.equal(page.button('冲销 / 更正'), undefined); assert.equal(page.button('补充 SN'), undefined);
  assert.equal(page.nodes().find((node) => node.type === 'input' && node.props.type === 'checkbox').props.disabled, true); assert.ok(page.button('查看批次档案'));
  page.click('正常'); assert.equal(page.state(), state); assert.equal(page.metric('本月实际出货'), '200 台'); assert.ok(page.button('冲销 / 更正'));
});

test('空数据与读取失败可恢复，临时展示状态不销毁已保存记录', async () => {
  const page = draftPage(); page.click('确认实际出库'); await page.save(); const state = page.state(); page.click('空数据');
  assert.equal(page.form(), undefined); assert.equal(page.rows().length, 0); assert.equal(page.button('登记出货').props.disabled, true); assert.match(page.text(), /本月暂无出货记录/);
  page.click('返回演示记录'); assert.equal(page.state(), state); assert.equal(page.metric('本月实际出货'), '200 台');
  page.click('读取失败'); assert.match(page.text(), /出货记录读取失败/); assert.equal(page.form(), undefined); page.click('重新读取'); assert.equal(page.state(), state); assert.equal(page.metric('本月实际出货'), '200 台');
});

test('月份翻页、未知目标与零目标均使用对应口径，不产生 Infinity', () => {
  const page = fixture('', (state) => ({ ...state, months: { ...state.months, '2026-08': { target: 0, completed: 50 } } }));
  page.click('上个月'); assert.equal(page.byId('shp-month').props.value, '2026-08'); assert.equal(page.metric('月度出货目标'), '0 台'); assert.match(page.text(), /达成率 —/);
  page.click('上个月'); assert.equal(page.metric('月度出货目标'), '—'); assert.equal(page.metric('本月整机完工'), '—'); assert.match(page.text(), /本月目标待维护/);
  assert.doesNotMatch(page.text(), /Infinity|NaN/); page.click('下个月'); assert.equal(page.byId('shp-month').props.value, '2026-08');
});

test('分页只显示八条，翻页后当前选择来自该页，搜索重新定位第一页', () => {
  const page = fixture('', (state) => ({ ...state, records: Array.from({ length: 10 }, (_, index) => ({ ...state.records[2], id: `page-ship-${index}`, documentNo: `PAGE-${index}`, createdAt: `2026-09-09T01:${String(index).padStart(2, '0')}:00.000Z` })) }));
  assert.equal(page.rows().length, 8); assert.equal(page.button('上一页').props.disabled, true); page.click('下一页'); assert.deepEqual(page.rowIds(), ['page-ship-1', 'page-ship-0']);
  assert.equal(page.selectedRow(), 'page-ship-1'); assert.equal(page.button('下一页').props.disabled, true); page.input('shp-query', 'PAGE-9'); assert.deepEqual(page.rowIds(), ['page-ship-9']); assert.match(page.text(), /第 1 \/ 1 页/);
});

test('多页台账中的记录深链接定位所在页，保存旧日期记录后列表继续显示当前选择', async () => {
  const page = fixture('?month=2026-09&selected=page-ship-0', (state) => ({ ...state, records: Array.from({ length: 10 }, (_, index) => ({ ...state.records[2], id: `page-ship-${index}`, documentNo: `PAGE-${index}`, createdAt: `2026-09-09T01:${String(index).padStart(2, '0')}:00.000Z` })) }));
  assert.equal(page.selectedRow(), 'page-ship-0'); assert.match(page.text(), /第 2 \/ 2 页/); page.click('修改登记'); await page.save({ note: '保持原实际日期，补充登记备注' });
  assert.equal(page.params().get('selected'), 'page-ship-0'); assert.equal(page.selectedRow(), 'page-ship-0'); assert.match(page.text(), /第 2 \/ 2 页/);
});

test('重置需要显式确认，取消保留新记录，确认后恢复原始汇总和单据', async () => {
  const page = draftPage(); page.click('确认实际出库'); await page.save(); page.click('重置演示');
  const reset = page.nodes().find((node) => node.type === 'AlertDialog' && /恢复初始演示记录/.test(normalized(node))); assert.equal(reset.props.open, true); assert.equal(page.metric('本月实际出货'), '200 台');
  reset.props.onOpenChange(false); page.render(); assert.equal(page.metric('本月实际出货'), '200 台'); page.click('重置演示'); page.click('重置演示数据');
  assert.equal(page.metric('本月实际出货'), '180 台'); assert.equal(page.state().records.length, 3); assert.equal(page.state().records.find((row) => row.id === ids.draftShipment).status, 'draft');
});

test('生产开关关闭时不注册实际出货预览路由，也不创建其懒加载', () => {
  const source = ts.createSourceFile('App.tsx', read('App.tsx'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let declaration, spread;
  function visit(node) {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === 'ShipmentPreviewPage') declaration = node;
    if (ts.isSpreadElement(node) && node.getText(source).includes('/__preview/shipments')) spread = node;
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
    assert.equal(loads.length, development ? 1 : 0); assert.deepEqual(exports.routes.map((route) => route.path), development ? ['/__preview/shipments'] : []);
  }
});
