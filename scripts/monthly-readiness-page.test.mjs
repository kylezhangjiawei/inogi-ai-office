import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
const read = (path) => readFileSync(new URL(`../src/app/${path}`, import.meta.url), 'utf8');
const compile = (source) => ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
const denied = () => assert.fail('月度齐套演示不得访问业务 API 或持久化');
const storage = new Proxy({}, { get: denied, set: denied });
const primitives = new Proxy({}, { get: (_target, name) => name });
const jsx = (type, props, key) => ({ type, props: props ?? {}, key });
const translate = (value, values = {}) => value.replace(/\{(\w+)\}/g, (match, key) => values[key] ?? match);
function evaluate(code, dependencies = {}, window = {}) { const exports = {}; new Function('exports', 'require', 'fetch', 'localStorage', 'sessionStorage', 'indexedDB', 'window', code)(exports, (name) => { assert.ok(Object.hasOwn(dependencies, name), `未审查依赖 ${name}`); return dependencies[name]; }, denied, storage, storage, storage, window); return exports; }
const model = evaluate(compile(read('procurement/monthly-readiness/monthlyReadinessModel.ts')));
const page = compile(read('procurement/monthly-readiness/MonthlyReadinessPreviewPage.tsx'));
function nodes(tree) { if (Array.isArray(tree)) return tree.flatMap(nodes); if (!tree || typeof tree !== 'object') return []; return [...(tree.type ? [tree] : []), ...Object.values(tree.props ?? {}).flatMap(nodes)]; }
function text(tree) { if (Array.isArray(tree)) return tree.map(text).join(' '); if (typeof tree === 'string' || typeof tree === 'number') return String(tree); if (!tree || typeof tree !== 'object') return ''; return [tree.props?.children, tree.props?.title, tree.props?.description, tree.props?.actions, tree.props?.action].map(text).join(' '); }
const normalized = (tree) => text(tree).replace(/\s+/g, ' ').trim();
function fixture(search = '') {
  const slots = [], effects = [], listeners = new Map(); let cursor = 0, tree, predicate, pending; let location = { pathname: '/__preview/monthly-readiness', search };
  const blocker = { state: 'unblocked', reset() { blocker.state = 'unblocked'; pending = undefined; }, proceed() { location = pending; pending = undefined; blocker.state = 'unblocked'; } };
  function navigate(next) { if (predicate?.({ currentLocation: location, nextLocation: next })) { blocker.state = 'blocked'; pending = next; } else location = next; }
  const hooks = { useState(initial) { const index = cursor++; if (!(index in slots)) slots[index] = typeof initial === 'function' ? initial() : initial; return [slots[index], (value) => { slots[index] = typeof value === 'function' ? value(slots[index]) : value; }]; }, useRef(initial) { const index = cursor++; return slots[index] ??= { current: initial }; }, useEffect(effect, deps) { const index = cursor++, old = slots[index]; if (!old || deps.some((value, i) => !Object.is(value, old.deps[i]))) { slots[index] = { deps, cleanup: old?.cleanup }; effects.push(() => { slots[index].cleanup?.(); slots[index].cleanup = effect(); }); } } };
  const dependencies = { react: hooks, 'react/jsx-runtime': { jsx, jsxs: jsx, Fragment: 'Fragment' }, 'lucide-react': primitives, 'react-router': { Link: 'Link', useSearchParams: () => [new URLSearchParams(location.search), (params) => navigate({ ...location, search: `?${params.toString()}` })], useBlocker: (next) => { predicate = next; return blocker; } }, '../../lib/i18n': { useI18n: () => ({ t: translate }) }, '../../order-processing/components/HorizonPage': primitives, './monthlyReadinessModel': model, '../../order-processing/horizon.css': {}, './monthly-readiness.css': {} };
  for (const name of ['button', 'input', 'label', 'sheet', 'alert-dialog']) dependencies[`../../components/ui/${name}`] = primitives;
  const exported = evaluate(page, dependencies, { addEventListener: (event, fn) => listeners.set(event, fn), removeEventListener: (event, fn) => { if (listeners.get(event) === fn) listeners.delete(event); } });
  const view = {
    render() { cursor = 0; tree = exported.MonthlyReadinessPreviewPage(); while (effects.length) effects.shift()(); return tree; },
    nodes: () => nodes(tree), text: () => normalized(tree), state: () => slots.find((value) => value && Array.isArray(value.snapshots)),
    button(label) { return view.nodes().find((node) => ['Button', 'AlertDialogAction', 'AlertDialogCancel'].includes(node.type) && (normalized(node) === label || node.props['aria-label'] === label)); },
    click(label) { const button = view.button(label); assert.ok(button, `${label}存在`); assert.ok(!button.props.disabled, `${label}可用`); button.props.onClick(); return view.render(); },
    byId: (id) => view.nodes().find((node) => node.props.id === id),
    input(id, value) { const field = view.byId(id); assert.ok(field, `${id}存在`); assert.ok(!field.props.disabled, `${id}可编辑`); field.props.onChange({ target: { value } }); return view.render(); },
    check(label, checked) { const wrapper = view.nodes().find((node) => node.type === 'label' && normalized(node).includes(label)); const field = nodes(wrapper).find((node) => node.type === 'input'); assert.ok(field); assert.ok(!field.props.disabled); field.props.onChange({ target: { checked } }); return view.render(); },
    navigate(pathname, search = '') { navigate({ pathname, search }); return view.render(); }, blocker, listeners, params: () => new URLSearchParams(location.search),
  }; view.render(); return view;
}

test('默认显示整月口径和缺失依据，不能保存确定预测', () => {
  const view = fixture(); assert.match(view.text(), /1,000/); assert.match(view.text(), /216/); assert.match(view.text(), /784/); assert.match(view.text(), /阀体 线边未耗用量待核对/); assert.equal(view.button('保存本次预测').props.disabled, true);
  view.click('查看物料 阀体'); assert.match(view.text(), /预计检验可用/); assert.match(view.text(), /2026-09-20/);
});
test('补齐来源不会改写屏幕结果，重新计算后才可保存快照', () => {
  const view = fixture(); view.click('补齐线边样例'); assert.match(view.text(), /来源数据已变化/); assert.equal(view.button('保存本次预测').props.disabled, true);
  view.click('按当前数据计算'); assert.match(view.text(), /600 套/); assert.match(view.text(), /784 套/); view.click('保存本次预测'); assert.equal(view.state().snapshots.length, 3); assert.equal(view.button('预测已保存').props.disabled, true);
});
test('保存失败保留预测，重试只追加一次快照', () => {
  const view = fixture(); view.click('补齐线边样例'); view.click('按当前数据计算'); view.check('下次保存失败', true); view.click('保存本次预测'); assert.match(view.text(), /本次预测未保存/); assert.equal(view.state().snapshots.length, 2); view.click('重试保存'); assert.equal(view.state().snapshots.length, 3); assert.match(view.text(), /已另存预测快照/);
});
test('日期截止控制按期订单；未下单独立情景不替换已下单预测', () => {
  const view = fixture(); view.click('补齐线边样例'); view.input('mr-mode', 'date'); view.input('mr-deadline', '2026-09-25'); view.click('按当前数据计算'); assert.match(view.text(), /680 套/); assert.match(view.text(), /104 套/);
  view.click('模拟交期延后'); view.input('mr-deadline', '2026-09-30'); view.check('同时比较未下单情景', true); view.click('按当前数据计算'); assert.match(view.text(), /600 套/); assert.match(view.text(), /含未下单情景 784 套/);
});
test('下月目标须填写，结果保留草稿情景属性', () => {
  const view = fixture(); view.click('补齐线边样例'); view.input('mr-month', '2026-10'); view.click('按当前数据计算'); assert.match(view.text(), /尚无正式整机目标/); assert.equal(view.button('保存本次预测').props.disabled, true);
  view.input('mr-target', '900'); view.click('按当前数据计算'); assert.match(view.text(), /草稿情景/); view.click('保存本次预测'); assert.equal(view.state().snapshots.at(-1).result.isDraft, true); assert.equal(view.params().get('month'), '2026-10');
});
test('未知或汇总产品保留来源，选择明确产品后才能计算', () => {
  for (const product of ['all', 'IN-100', 'product-in100', 'unmapped']) { const view = fixture(`?product=${product}&scope=owned`); assert.match(view.text(), new RegExp(product)); assert.match(view.text(), /等待选择产品/); assert.equal(view.button('按当前数据计算').props.disabled, true); view.input('mr-product', 'Q5'); assert.equal(view.params().get('product'), 'Q5'); assert.equal(view.params().get('scope'), 'owned'); view.click('按当前数据计算'); assert.match(view.text(), /280/); }
});
test('历史查看不改写快照，重算另存带来源 ID，已有填写有放弃保护', () => {
  const view = fixture(); const before = JSON.stringify(view.state().snapshots); view.click('补齐线边样例'); view.input('mr-mode', 'date'); view.click('查看快照 MR-20260907-002'); assert.match(view.text(), /当时快照/); view.click('按当前数据重算并准备另存'); assert.equal(view.nodes().find((node) => node.type === 'AlertDialog' && normalized(node).includes('放弃未保存')).props.open, true);
  view.click('放弃并继续'); assert.equal(JSON.stringify(view.state().snapshots), before); view.click('保存本次预测'); assert.equal(view.state().snapshots.at(-1).sourceSnapshotId, 'MR-20260907-002'); assert.equal(JSON.stringify(view.state().snapshots.slice(0, 2)), before);
});
test('未保存预测阻止离开且安装刷新保护，保存后解除', () => {
  const view = fixture(); view.click('补齐线边样例'); view.click('按当前数据计算'); assert.ok(view.listeners.has('beforeunload')); view.navigate('/__preview'); assert.equal(view.blocker.state, 'blocked'); view.blocker.reset(); view.render(); view.click('保存本次预测'); assert.equal(view.listeners.has('beforeunload'), false); view.navigate('/__preview'); assert.equal(view.blocker.state, 'unblocked');
});
test('只读禁用修改与保存，读取失败恢复保留条件', () => {
  const view = fixture(); view.input('mr-month', '2026-10'); view.input('mr-target', '850'); view.click('读取失败'); assert.match(view.text(), /月度来源读取失败/); view.click('重新读取'); assert.equal(view.byId('mr-target').props.value, 850); view.click('只读'); assert.equal(view.byId('mr-target').props.disabled, true); assert.equal(view.button('按当前数据计算').props.disabled, true); assert.equal(view.button('保存本次预测').props.disabled, true);
});

test('同页外部产品月份切换同步条件，未保存时仍先阻止离开', () => {
  const view = fixture(); view.navigate('/__preview/monthly-readiness', '?product=Q5&month=2026-10'); view.render(); assert.equal(view.byId('mr-product').props.value, 'Q5'); assert.equal(view.byId('mr-month').props.value, '2026-10');
  view.input('mr-target', '500'); view.navigate('/__preview/monthly-readiness', '?product=Q7&month=2026-09'); assert.equal(view.blocker.state, 'blocked'); assert.equal(view.byId('mr-target').props.value, 500);
});
