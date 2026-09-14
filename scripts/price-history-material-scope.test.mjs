import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

const source = readFileSync(new URL('../src/app/procurement/components/PriceHistoryModal.tsx', import.meta.url), 'utf8');
const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
const primitives = new Proxy({}, { get: (_, name) => name });
const nodes = (tree) => Array.isArray(tree) ? tree.flatMap(nodes) : tree && typeof tree === 'object' ? [tree, ...nodes(tree.props?.children)] : [];
const text = (tree) => Array.isArray(tree) ? tree.map(text).join(' ') : tree && typeof tree === 'object' ? text(tree.props?.children) : tree == null || typeof tree === 'boolean' ? '' : String(tree);
const t = (value, params = {}) => value.replace(/\{(\w+)\}/g, (match, name) => params[name] ?? match);
const quote = (id, materialId, patch = {}) => ({ id, materialId, materialName: '同名阀体', supplierName: `厂家-${materialId}`, unitPrice: materialId === 'one' ? 30 : 1, currency: 'CNY', leadTimeDays: 3, quoteDate: '2026-09-14', isSelected: false, ...patch });
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };

function fixture({ props: patch = {}, rows = [quote('q-one', 'one'), quote('q-two', 'two')], get } = {}) {
  const slots = [], reads = [];
  const props = { materialName: '同名阀体', materialId: 'one', open: true, onClose() {}, ...patch };
  let cursor = 0, dirty = true, effects = [], tree;
  const same = (a, b) => a && b && a.length === b.length && a.every((value, i) => Object.is(value, b[i]));
  const react = {
    useState(initial) { const n = cursor++; if (!(n in slots)) slots[n] = typeof initial === 'function' ? initial() : initial; return [slots[n], (value) => { const next = typeof value === 'function' ? value(slots[n]) : value; if (!Object.is(next, slots[n])) { slots[n] = next; dirty = true; } }]; },
    useRef(initial) { const n = cursor++; return slots[n] ??= { current: initial }; },
    useMemo(fn, deps) { const n = cursor++; if (!same(slots[n]?.deps, deps)) slots[n] = { deps, value: fn() }; return slots[n].value; },
    useCallback(fn, deps) { return react.useMemo(() => fn, deps); },
    useEffect(fn, deps) { const n = cursor++, previous = slots[n]; if (!same(previous?.deps, deps)) { const next = { deps }; slots[n] = next; effects.push(() => { previous?.cleanup?.(); next.cleanup = fn(); }); } },
  };
  const jsx = (type, props, key) => typeof type === 'function' ? type(props) : { type, props, key };
  const deps = {
    react, 'react/jsx-runtime': { jsx, jsxs: jsx, Fragment: 'Fragment' },
    '../../lib/i18n': { useI18n: () => ({ t }), i18nLocale: () => 'zh-CN' },
    '../../components/ui/utils': { cn: (...values) => values.filter(Boolean).join(' ') },
    './common': { fmtMoney: (value) => `¥${value.toFixed(2)}` },
    '../../components/TranslatableText': { AutoTranslatedText: ({ text }) => text },
    '../../lib/procurementApi': { listQuotations: (query) => { reads.push(query); return get ? get(query) : Promise.resolve(rows.filter((row) => query.materialId ? row.materialId === query.materialId : row.materialName === query.materialName)); } },
  };
  const exports = {};
  new Function('exports', 'require', code)(exports, (name) => {
    if (name in deps) return deps[name];
    assert.ok(name === 'lucide-react' || name.startsWith('../../components/'), name); return primitives;
  });
  const view = {
    reads, props,
    render({ flushEffects = true } = {}) { for (let i = 0; i < 20; i++) { cursor = 0; dirty = false; tree = exports.PriceHistoryModal(props); if (!flushEffects) return tree; const jobs = effects; effects = []; jobs.forEach((job) => job()); if (!dirty) return tree; } assert.fail('render did not settle'); },
    async settle() { await new Promise((resolve) => setImmediate(resolve)); return view.render(); },
    text: () => text(tree), all: () => nodes(tree),
    setProps(patch, options) { Object.assign(props, patch); return view.render(options); },
    click(label) { const button = nodes(tree).find((node) => ['button', 'Button'].includes(node.type) && text(node).trim() === label); assert.ok(button, label); button.props.onClick(); return view.render(); },
    unmount() { slots.forEach((slot) => slot?.cleanup?.()); },
  };
  view.render(); return view;
}

test('同名不同物料的历史价格按正式 ID 查询，另一规格低价不参与结果', async () => {
  const view = fixture(); await view.settle();
  assert.deepEqual(view.reads, [{ materialId: 'one' }]);
  assert.match(view.text(), /厂家-one/);
  assert.doesNotMatch(view.text(), /厂家-two|¥1\.00/);
  assert.match(view.text(), /¥30\.00/);
});

test('无正式 ID 时明确同名候选，不以名称候选计算最低价、均价或趋势', async () => {
  const view = fixture({ props: { materialId: undefined } }); await view.settle();
  assert.deepEqual(view.reads, [{ materialName: '同名阀体' }]);
  assert.match(view.text(), /同名候选报价/);
  assert.match(view.text(), /不同规格或单位/);
  assert.match(view.text(), /厂家-one/); assert.match(view.text(), /厂家-two/);
  assert.doesNotMatch(view.text(), /已读最低|已读均价|该币种最低|价格趋势/);
});

test('已读范围明确最多 200 条，币种切换继续隔离统计', async () => {
  const view = fixture({ rows: [quote('cny', 'one'), quote('usd', 'one', { currency: 'USD', unitPrice: 1 })] }); await view.settle();
  assert.match(view.text(), /最近最多 200 条/); assert.match(view.text(), /已读取 2 条/);
  assert.match(view.text(), /已读最低|已读均价/); assert.doesNotMatch(view.text(), /历史最低|历史均价|USD 1\.00/);
  view.all().find((node) => node.type === 'ToggleGroup' && node.props['aria-label'] === '历史报价比较币种').props.onValueChange('USD'); view.render();
  assert.match(view.text(), /USD 1\.00/); assert.doesNotMatch(view.text(), /¥30\.00/);
});

test('切换同名物料时新请求完成前隐去旧结果，旧请求晚到不能覆盖新物料', async () => {
  for (const fails of [false, true]) {
    const first = deferred(), second = deferred(); let calls = 0;
    const view = fixture({ get: () => ++calls === 1 ? first.promise : second.promise });
    view.setProps({ materialId: 'two' }); second.resolve([quote('new', 'two')]); await view.settle();
    if (fails) first.reject(new Error('上一物料读取错误')); else first.resolve([quote('old', 'one')]);
    await view.settle();
    assert.match(view.text(), /厂家-two/); assert.doesNotMatch(view.text(), /厂家-one|上一物料读取错误/);
    view.setProps({ materialId: 'three' }, { flushEffects: false });
    assert.doesNotMatch(view.text(), /厂家-two/);
    view.unmount();
  }
});

test('关闭后迟到的成功与失败不回填，重新打开重新读取', async () => {
  for (const fails of [false, true]) {
    const old = deferred(); let calls = 0;
    const view = fixture({ get: () => ++calls === 1 ? old.promise : Promise.resolve([quote('fresh', 'one')]) });
    view.setProps({ open: false });
    if (fails) old.reject(new Error('关闭前旧错误')); else old.resolve([quote('stale', 'one', { supplierName: '旧厂家' })]);
    await view.settle(); assert.equal(view.text(), '');
    view.setProps({ open: true }); await view.settle();
    assert.equal(view.reads.length, 2); assert.match(view.text(), /厂家-one/); assert.doesNotMatch(view.text(), /旧厂家|关闭前旧错误/);
  }
});

test('新身份读取失败不显示上一物料，重试仍查询当前 ID', async () => {
  let calls = 0;
  const view = fixture({ get: async (query) => { calls++; if (calls === 2) throw new Error('读取失败'); return [quote(`q-${calls}`, query.materialId)]; } });
  await view.settle(); view.setProps({ materialId: 'two' }); await view.settle();
  assert.match(view.text(), /读取失败/); assert.doesNotMatch(view.text(), /厂家-one|暂无历史报价/);
  view.click('重新加载'); await view.settle();
  assert.deepEqual(view.reads.at(-1), { materialId: 'two' }); assert.match(view.text(), /厂家-two/);
});

test('无物料标识不执行全量查询，错误身份响应不形成价格摘要', async () => {
  const empty = fixture({ props: { materialId: undefined, materialName: '' } }); await empty.settle();
  assert.equal(empty.reads.length, 0); assert.match(empty.text(), /缺少物料/);
  const mismatch = fixture({ get: async () => [quote('wrong', 'two')] }); await mismatch.settle();
  assert.match(mismatch.text(), /物料身份不一致/); assert.doesNotMatch(mismatch.text(), /厂家-two|已读最低/);
});

test('物料与采购任务抽屉继续传递各自的正式物料 ID，不从名称猜测', () => {
  const material = readFileSync(new URL('../src/app/procurement/components/MaterialDetailDrawer.tsx', import.meta.url), 'utf8');
  const task = readFileSync(new URL('../src/app/procurement/components/TaskDetailDrawer.tsx', import.meta.url), 'utf8');
  assert.match(material, /<PriceHistoryModal materialId=\{material\.id\} materialName=\{material\.name\}/);
  assert.match(task, /<PriceHistoryModal materialId=\{task\.materialId\} materialName=\{task\.materialName\}/);
});
