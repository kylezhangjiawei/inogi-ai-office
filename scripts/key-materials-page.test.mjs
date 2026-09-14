import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
const read = (name) => readFileSync(new URL(`../src/app/procurement/key-materials/${name}`, import.meta.url), 'utf8');
const compile = (source) => ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
const forbidden = () => assert.fail('预览页面不能读取真实服务或持久化');
const noStorage = new Proxy({}, { get: forbidden, set: forbidden });
function evaluate(source, deps, window = {}) {
  const exports = {};
  new Function('exports', 'require', 'fetch', 'localStorage', 'sessionStorage', 'window', compile(source))(exports, (key) => { assert.ok(Object.hasOwn(deps, key), `审查依赖 ${key}`); return deps[key]; }, forbidden, noStorage, noStorage, window);
  return exports;
}
const model = evaluate(read('keyMaterialsModel.ts'), {});
const primitives = new Proxy({}, { get: (_, name) => name });
const jsx = (type, props, key) => ({ type, props: props ?? {}, key });
function nodes(tree) {
  if (Array.isArray(tree)) return tree.flatMap(nodes);
  if (!tree || typeof tree !== 'object') return [];
  if (typeof tree.type === 'function') return nodes(tree.type(tree.props));
  if (['Dialog', 'AlertDialog'].includes(tree.type) && !tree.props.open) return [];
  return [...(tree.type ? [tree] : []), ...Object.values(tree.props ?? {}).flatMap(nodes)];
}
function content(tree) {
  if (Array.isArray(tree)) return tree.map(content).join(' ');
  if (typeof tree === 'string' || typeof tree === 'number') return String(tree);
  if (!tree || typeof tree !== 'object') return '';
  if (typeof tree.type === 'function') return content(tree.type(tree.props));
  if (['Dialog', 'AlertDialog'].includes(tree.type) && !tree.props.open) return '';
  return ['children', 'title', 'description', 'actions', 'action'].map((key) => content(tree.props?.[key])).join(' ');
}
const text = (node) => content(node).replace(/\s+/g, ' ').trim();
function fixture(initial = '') {
  const slots = [], effects = [], listeners = new Map(); let cursor = 0, tree, predicate, pending;
  let location = { pathname: '/__preview/key-materials', search: initial };
  const blocker = { state: 'unblocked', reset() { blocker.state = 'unblocked'; pending = null; }, proceed() { location = pending; pending = null; blocker.state = 'unblocked'; } };
  function navigate(next) { if (predicate?.({ currentLocation: location, nextLocation: next })) { pending = next; blocker.state = 'blocked'; } else location = next; }
  const hooks = {
    useState(initial) { const index = cursor++; if (!(index in slots)) slots[index] = typeof initial === 'function' ? initial() : initial; return [slots[index], (value) => { slots[index] = typeof value === 'function' ? value(slots[index]) : value; }]; },
    useRef(initial) { const index = cursor++; return slots[index] ??= { current: initial }; },
    useEffect(effect, deps) { const index = cursor++, old = slots[index]; if (!old || deps.some((value, i) => !Object.is(value, old.deps[i]))) { slots[index] = { deps, cleanup: old?.cleanup }; effects.push(() => { slots[index].cleanup?.(); slots[index].cleanup = effect(); }); } },
  };
  const deps = {
    react: hooks, 'react/jsx-runtime': { jsx, jsxs: jsx, Fragment: 'Fragment' }, 'lucide-react': primitives,
    'react-router': { Link: 'Link', useSearchParams: () => [new URLSearchParams(location.search), (params) => navigate({ ...location, search: `?${params}` })], useBlocker: (fn) => { predicate = fn; return blocker; } },
    '../../components/ui/alert-dialog': primitives, '../../components/ui/dialog': primitives,
    '../../order-processing/components/HorizonPage': primitives, './keyMaterialsModel': model,
    '../../order-processing/horizon.css': {}, './key-materials.css': {},
  };
  const { KeyMaterialsPreviewPage } = evaluate(read('KeyMaterialsPreviewPage.tsx'), deps, { addEventListener: (event, callback) => listeners.set(event, callback), removeEventListener: (event) => listeners.delete(event) });
  const view = {
    render() { cursor = 0; tree = KeyMaterialsPreviewPage(); while (effects.length) effects.shift()(); return view; },
    nodes() { return nodes(tree); }, text() { return text(tree); },
    button(label) { return view.nodes().find((node) => ['button', 'AlertDialogAction', 'AlertDialogCancel'].includes(node.type) && text(node) === label); },
    click(label) { const button = view.button(label); assert.ok(button, `找到按钮 ${label}`); assert.equal(Boolean(button.props.disabled), false, `可操作 ${label}`); button.props.onClick?.(); return view.render(); },
    field(label) { return view.nodes().find((node) => node.props['aria-label'] === label); },
    input(label, value) { const input = view.field(label); assert.ok(input, `找到字段 ${label}`); input.props.onChange({ target: { value } }); return view.render(); },
    checkbox(label, checked) { const item = view.nodes().find((node) => node.type === 'label' && text(node).includes(label)); assert.ok(item, label); nodes(item).find((node) => node.type === 'input').props.onChange({ target: { checked } }); return view.render(); },
    open(id) { const row = view.nodes().find((node) => node.type === 'button' && node.props.className === 'km-clue' && text(node).startsWith(id)); assert.ok(row, id); row.props.onClick(); return view.render(); },
    clues() { return view.nodes().filter((node) => node.type === 'button' && node.props.className === 'km-clue'); },
    submit() { const form = view.nodes().find((node) => node.type === 'form'); assert.ok(form); form.props.onSubmit({ preventDefault() {} }); return view.render(); },
    navigate(search, pathname = location.pathname) { navigate({ pathname, search }); return view.render(); },
    params() { return new URLSearchParams(location.search); },
    beforeUnload() { const event = { prevented: false, preventDefault() { this.prevented = true; }, returnValue: undefined }; listeners.get('beforeunload')?.(event); return event; },
    state() { return slots.find((slot) => slot?.clues && slot?.materials); },
  };
  return view.render();
}
test('目录默认完整显示31条、原话歧义、两类明细及非重点BOM风险', () => {
  const view = fixture(); assert.equal(view.clues().length, 31);
  for (const phrase of ['CFO', '西安美', '“矿板PCB”', '“第二版PCB”', '“704”电池', '“408”电池', '网格包', '企业 ERP 与完整 BOM 待导入', '装配螺钉']) assert.ok(view.text().includes(phrase), phrase);
});
test('搜索与状态切换有结果且空态可恢复全部目录', () => {
  const view = fixture(); view.input('搜索物件、料号或供应商', '不存在的物件'); assert.equal(view.clues().length, 0); assert.match(view.text(), /没有符合筛选/);
  view.click('清空筛选'); assert.equal(view.clues().length, 31); view.click('资料待核'); assert.ok(view.clues().length > 0 && view.clues().length < 31);
  view.click('全部关键物件'); view.input('搜索物件、料号或供应商', 'K19'); assert.equal(view.clues().length, 1); view.open('K19'); assert.match(view.text(), /本月需求 0/);
});
test('月度视图按唯一料号展开，单位和共享库存边界明确', () => {
  const view = fixture(); view.click('月度明细'); assert.match(view.text(), /产品筛选不做库存分配，各产品预测不可相加/);
  const rows = view.nodes().filter((node) => node.type === 'button' && node.props.className === 'km-material-link');
  assert.equal(rows.length, 22); view.input('月度明细分组', 'supplier');
  assert.equal(view.nodes().filter((node) => node.type === 'button' && node.props.className === 'km-material-link').length, 22);
});
test('未知产品保留查询并停止数量显示，跨年未知库存不回退已知样例', () => {
  const view = fixture('?product=IN-100&month=2027-01&scope=owned'); assert.equal(view.params().get('product'), 'IN-100'); assert.match(view.text(), /来源上下文待映射/); assert.equal(view.clues().length, 31);
  view.click('月度明细'); assert.equal(view.nodes().filter((node) => node.props.className === 'km-material-link').length, 0);
  view.input('适用产品', 'Q7'); assert.equal(view.params().get('month'), '2027-01'); assert.equal(view.params().get('scope'), 'owned'); assert.match(view.text(), /待补齐/);
});
test('物件来源不伪造订单、库存、质量单据跳转，真实路由保留上下文', () => {
  const view = fixture('?product=Q7&month=2026-09&scope=all'); view.open('K01');
  for (const phrase of ['订单明细未接通', '库存批次未接通', 'issue_id 未接通', '供应商详情未接通']) assert.ok(view.text().includes(phrase));
  const hrefs = view.nodes().filter((node) => node.type === 'Link').map((node) => node.props.to);
  assert.ok(hrefs.includes('/__preview/monthly-readiness?month=2026-09&product=Q7&scope=all')); assert.ok(hrefs.every((href) => href === '/__preview' || href.startsWith('/__preview/monthly-readiness?')));
});
test('网格包人工确认不纳入，历史保留且31条目录不减少', () => {
  const view = fixture(); view.open('K29'); view.click('人工核对映射'); view.input('网格包是否纳入', 'excluded'); view.input('映射核对人', '演示采购'); view.input('映射核对依据', '业务确认本期不纳入'); view.submit();
  assert.equal(view.state().clues[28].inclusion, 'excluded'); assert.equal(view.state().history.length, 1); assert.match(view.text(), /已确认不纳入/); assert.equal(view.clues().length, 31); assert.match(view.text(), /核对记录已保存在本页/);
});
test('填写中切换月份有放弃确认，取消保留草稿，浏览器离开也提醒', () => {
  const view = fixture(); view.open('K01'); view.click('人工核对映射'); view.input('映射核对依据', '待保存依据');
  assert.equal(view.beforeUnload().prevented, true); view.input('查看月份', '2026-10'); assert.match(view.text(), /放弃未保存/); assert.notEqual(view.params().get('month'), '2026-10');
  view.click('继续填写'); assert.equal(view.field('映射核对依据').props.value, '待保存依据'); view.input('查看月份', '2026-10'); view.click('放弃并继续'); assert.equal(view.params().get('month'), '2026-10');
  assert.equal(view.beforeUnload().prevented, false);
});
test('过期来源阻止保存，重新核对后保留填写并可重试', () => {
  const view = fixture(); view.open('K01'); view.click('人工核对映射'); view.input('映射核对人', '演示采购'); view.input('映射核对依据', '当前图纸核对'); view.click('模拟来源更新');
  assert.equal(view.button('保存本页核对').props.disabled, true); assert.match(view.text(), /来源已从 v\s*1 更新至 v\s*2/); view.click('已核对当前来源，保留填写'); view.submit(); assert.equal(view.state().history.length, 1);
});
test('模拟映射保存失败保留草稿与旧记录，重试仅新增一条历史', () => {
  const view = fixture(); view.checkbox('下次保存模拟失败', true); view.open('K01'); view.click('人工核对映射'); view.input('映射核对人', '演示采购'); view.input('映射核对依据', '当前规格核对'); view.submit();
  assert.match(view.text(), /演示保存失败/); assert.equal(view.state().history.length, 0); assert.equal(view.field('映射核对依据').props.value, '当前规格核对'); view.submit(); assert.equal(view.state().history.length, 1);
});
test('白板入口明确人工草稿，缺原文不能提交', () => {
  const view = fixture(); view.click('白板人工草稿'); assert.match(view.text(), /照片识别服务尚未接通/); view.input('映射核对人', '演示采购'); view.input('映射核对依据', '白板料号核对'); view.submit(); assert.match(view.text(), /请先录入白板原文/);
  view.input('白板原文', '白板左上 210 阀，核对正式料号'); view.submit(); assert.match(view.state().history[0].note, /白板人工录入/);
});
test('CSV必须先校验与勾选确认，模拟导入失败安全重试并记录快照历史', () => {
  const view = fixture(); view.click('导入 ERP 明细'); view.input('CSV 内容', model.csvTemplate()); view.click('校验并预览'); assert.equal(view.button('确认导入本页').props.disabled, true);
  view.input('导入核对人', '演示采购'); view.input('导入依据', 'ERP CSV 逐行确认'); view.checkbox('已逐行核对料号', true); view.checkbox('下次保存模拟失败', true); view.submit();
  assert.match(view.text(), /演示导入失败/); assert.equal(view.state().lastSuccess, null); assert.equal(view.state().importHistory.length, 0);
  view.submit(); assert.equal(view.state().importHistory.length, 1); assert.ok(view.state().lastSuccess); assert.match(view.text(), /导入快照变更历史/); assert.match(view.text(), /280/);
});
test('修改CSV后旧校验和勾选确认失效，行错误可见且不能导入', () => {
  const view = fixture(); view.click('导入 ERP 明细'); view.input('CSV 内容', model.csvTemplate()); view.click('校验并预览'); view.checkbox('已逐行核对料号', true);
  view.input('CSV 内容', 'wrong,header\n1,2'); assert.equal(view.button('确认导入本页'), undefined); view.click('校验并预览'); assert.match(view.text(), /字段不匹配/); assert.equal(view.button('确认导入本页').props.disabled, true);
});
