import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
const nodes = x => Array.isArray(x) ? x.flatMap(nodes) : x && typeof x === 'object' ? [x, ...nodes(x.props?.children)] : [];
const text = x => Array.isArray(x) ? x.map(text).join(' ') : x && typeof x === 'object' ? text(x.props?.children) : String(x ?? '');
async function fixture(component, props, permissions = []) {
  const panel = component !== 'StockPlanBomBasis', file = panel ? 'StockPlanPanel' : component;
  const source = readFileSync(new URL(`../src/app/procurement/components/${file}.tsx`, import.meta.url), 'utf8') + (panel ? `\nexport { ${component} };` : '');
  const code = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const slots = [], effects = [], calls = []; let cursor = 0, tree;
  const react = {
    useState(v) { const i = cursor++; if (!(i in slots)) slots[i] = typeof v === 'function' ? v() : v; return [slots[i], v => { slots[i] = typeof v === 'function' ? v(slots[i]) : v; }]; },
    useRef(v) { const i = cursor++; return slots[i] ??= { current: v }; }, useMemo: fn => fn(),
    useEffect(fn, deps) { const i = cursor++; if (!slots[i] || deps.some((v,j) => v !== slots[i][j])) { slots[i] = deps; effects.push(fn); } },
  };
  const devices = [{ productRoot: { productId: 'p' }, productLine: 'Q5', revisions: [{ id: 'r1', version: 1 }] }, { productRoot: { productId: 'other' }, productLine: 'Q5', revisions: [{ id: 'wrong', version: 3 }] }];
  const dependencies = {
    react, 'react/jsx-runtime': { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) },
    '../../hooks/usePermission': { usePermission: p => permissions.includes(p) },
    '../../lib/i18n': { useI18n: () => ({ t: v => v }) },
    '../../lib/procurementApi': { readBomDeviceOptions: async () => ({ devices }), confirmStockPlanBomBasis: async (...args) => { calls.push(args); throw Error('数据已更新，请刷新'); }, getProcStockPlanReadiness: async () => null },
    '../data': { useProcurementProducts: () => [] },
  };
  const exports = {}; new Function('exports', 'require', code)(exports, name => dependencies[name] ?? new Proxy({}, { get: (_, k) => k }));
  const render = () => { cursor = 0; return tree = exports[component](props); };
  const f = { calls, render, find: fn => nodes(tree).find(fn), async settle() { effects.splice(0).forEach(fn => fn()); await new Promise(setImmediate); render(); }, click(label) { const n = nodes(tree).find(n => n.props?.onClick && text(n) === label); assert.ok(n, label); n.props.onClick(); render(); } };
  render(); await f.settle(); return f;
}
const plan = { id: 'p1', planType: 'machine', productId: 'p', productLine: 'Q5', materialName: '整机', unit: '套', targetQty: 100, qualifiedQty: 0, batches: [], tasks: [{ id: 'existing' }], updatedAt: '2026-09-22' };

test('月度界面将同型号不同发布依据分组', async () => {
  const f = await fixture('MonthlyPlanOverview', { month: '2026-09', plans: [{ ...plan, bomRevisionId: 'r1', bomVersion: 1 }, { ...plan, id: 'p2', bomRevisionId: 'r2', bomVersion: 2 }] });
  const select = f.find(n => n.props?.label === '月度统计物料');
  assert.equal(select.props.options.length, 2);
  assert.notEqual(select.props.options[0].label, select.props.options[1].label);
});

test('历史备货核对只选本产品版本，冲突保留输入与请求号', async () => {
  const f = await fixture('StockPlanBomBasis', { plan, canCreate: true, onSaved() {} }, ['bom:publish']);
  assert.match(text(f.render()), /不覆盖、不重复生成/);
  f.click('确认备货 BOM 依据'); await f.settle();
  assert.equal(f.find(n => n.type === 'option' && n.props.value === 'wrong'), undefined);
  f.find(n => n.type === 'NativeSelect').props.onChange({ target: { value: 'r1' } });
  f.find(n => n.type === 'Textarea').props.onChange({ target: { value: '确认当前依据' } }); f.render();
  f.click('确认采用'); await f.settle();
  assert.match(text(f.render()), /数据已更新/);
  assert.equal(f.find(n => n.type === 'Textarea').props.value, '确认当前依据');
  f.click('确认采用'); await f.settle();
  assert.equal(f.calls[0][1].requestId, f.calls[1][1].requestId);
  assert.equal(f.calls[0][1].expectedUpdatedAt, plan.updatedAt);
});
