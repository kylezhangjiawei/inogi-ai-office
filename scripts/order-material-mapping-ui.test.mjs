import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
const source = readFileSync(new URL('../src/app/order-processing/components/OrderMaterialMappingDialog.tsx', import.meta.url), 'utf8');
const code = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
const elements = value => Array.isArray(value) ? value.flatMap(elements) : value && typeof value === 'object' ? [value, ...elements(value.props?.children)] : [];
async function fixture() {
  let cursor = 0, tree, effects = [], closed = 0; const slots = [], calls = [];
  const react = {
    useState(initial) { const i = cursor++; if (!(i in slots)) slots[i] = initial; return [slots[i], next => { slots[i] = typeof next === 'function' ? next(slots[i]) : next; }]; },
    useRef(initial) { const i = cursor++; return slots[i] ??= { current: initial }; },
    useEffect(fn, deps) { const i = cursor++; if (!slots[i] || deps.some((v,j) => v !== slots[i][j])) { slots[i] = deps; effects.push(fn); } },
  };
  const api = { materialOptions: async () => ({ materials: [{ id: 'm', tpInventoryCode: 'ERP', name: '阀', spec: 'R1', unit: '件' }], warehouses: ['成品仓'] }), confirmMaterial: async (...args) => { calls.push(args); throw Error('来源已更新，草稿保留'); } };
  const deps = { '../../lib/i18n': { useI18n: () => ({ t: text => text }) }, react, 'react/jsx-runtime': { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) }, '../../lib/orderProcessingApi': { orderProcessingApi: api } };
  const result = {}; new Function('exports', 'require', 'window', code)(result, name => deps[name] ?? new Proxy({}, { get: (_, key) => key }), { setTimeout: fn => setTimeout(fn, 0), clearTimeout });
  const product = { id: 'CUSTOMER', lineId: 'l', name: '阀', spec: 'R1', unit: '件', orderQty: 3, stockCheck: { updatedAt: '2026-09-01', sourceFingerprint: 'a'.repeat(64) } };
  const render = () => { cursor = 0; return tree = result.OrderMaterialMappingDialog({ orderId: 'o', product, onClose: () => closed++, onRefresh: async () => {} }); };
  const settle = async () => { effects.splice(0).forEach(fn => fn()); await new Promise(resolve => setTimeout(resolve, 15)); render(); };
  render(); await settle();
  return { render, settle, calls, product, closed: () => closed, find: fn => elements(tree).find(fn) };
}
test('mapping conflict preserves selected material and reason, retry reuses request identity', async () => {
  const f = await fixture();
  f.find(node => node.props?.id === 'order-material-choice').props.onChange({ target: { value: 'm' } });
  f.find(node => node.props?.id === 'order-material-reason').props.onChange({ target: { value: '逐项核对一致' } }); f.render();
  await f.find(node => node.type === 'form').props.onSubmit({ preventDefault() {} }); f.render();
  assert.equal(f.find(node => node.props?.role === 'alert') !== undefined, true);
  assert.equal(f.find(node => node.props?.id === 'order-material-reason').props.value, '逐项核对一致');
  assert.equal(f.find(node => node.props?.id === 'order-material-choice').props.value, 'm');
  await f.find(node => node.type === 'form').props.onSubmit({ preventDefault() {} });
  assert.equal(f.calls[0][2].requestId, f.calls[1][2].requestId); assert.equal(f.closed(), 0);
  f.product.stockCheck.updatedAt = '2026-09-22'; f.render();
  await f.find(node => node.type === 'form').props.onSubmit({ preventDefault() {} });
  assert.notEqual(f.calls[1][2].requestId, f.calls[2][2].requestId);
});
test('workbench current quantity never falls back to historical stock and exposes explicit scope', () => {
  const page = readFileSync(new URL('../src/app/order-processing/pages/Workbench.tsx', import.meta.url), 'utf8');
  assert.match(page, /stockWarehouses/); assert.match(page, /availableQty == null/); assert.match(page, /canMapMaterial && p.lineId/); assert.doesNotMatch(page, /p\.stockQty/);
  const api = readFileSync(new URL('../src/app/lib/orderProcessingApi.ts', import.meta.url), 'utf8');
  for (const action of ['createStockIn', 'createStockOut', 'adjustInventory', 'recognizeStockIn']) assert.doesNotMatch(api, new RegExp(action + '\\('));
});
