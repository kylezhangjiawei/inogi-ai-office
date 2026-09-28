import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

function compile(path, require = () => ({})) {
  const source = readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const exports = {}; new Function('require', 'exports', code)(require, exports); return exports;
}
const viewState = compile('src/app/production/execution/productionViewState.ts');
const element = (type, props) => ({ type, props: props || {} });
const nodes = tree => Array.isArray(tree) ? tree.flatMap(nodes) : tree && typeof tree === 'object' && tree.props ? [tree, ...nodes(tree.props.children)] : [];
const content = tree => Array.isArray(tree) ? tree.map(content).join('') : tree && typeof tree === 'object' && tree.props ? content(tree.props.children) : tree == null ? '' : String(tree);
const flush = () => new Promise(resolve => setImmediate(resolve));

function fixture({ canPlan = true, status = 'unallocated', canAllocate = true, assignedQty = 0, query = '' } = {}) {
  let slot = 0, pending = [];
  const slots = [], writes = [], reads = []; let params = new URLSearchParams(query);
  let data = {
    sourceToken: 'read-basis-1', planVersion: 3, date: '2026-09-30', remainingQty: 60, currentSets: 0, projectedSets: 0,
    history: [{ id: 'snapshot-1', date: '2026-09-30', at: '2026-09-20T00:00:00.000Z', actorName: '计划员', planVersion: 2, currentSets: 0, projectedSets: 60 }],
    lines: [{ code: 'M1', name: '阀体', unit: '件', qtyPer: 1, demand: 60, remainingDemand: 60, warehouse: 0, otherReserved: 0, warehousePending: 0, lineQty: 0, incoming: 0, gap: 60, ownReserved: 0, problems: [], lineSide: [],
      purchase: [{ id: 'po-line-1', orderNo: 'PO-60', supplier: '供应商', quantity: 60, date: '2026-09-29', included: false, allocationStatus: status,
        assignedQty, allocatedQty: 0, otherAllocatedQty: 20, maxAllocatable: 40, canAllocate, note: '共享采购尚未分配给本计划，不计预计覆盖', allocationHistory: [] }] }],
  };
  const controls = {};
  for (const name of ['Button', 'Input', 'NativeSelect', 'Card', 'Table', 'TableBody', 'TableCell', 'TableHead', 'TableHeader', 'TableRow', 'OperationalDialog', 'ProductionMetrics', 'ProductionPagination', 'ProductionEmpty']) controls[name] = name;
  const component = compile('src/app/production/execution/ReadinessPanel.tsx', name => {
    if (name === 'react-router') return { useSearchParams: () => [params, updater => { params = typeof updater === 'function' ? updater(params) : updater; }] };
    if (name === 'react/jsx-runtime') return { jsx: element, jsxs: element, Fragment: 'Fragment' };
    if (name === 'react') return {
      useState(initial) { const index = slot++; if (!(index in slots)) slots[index] = typeof initial === 'function' ? initial() : initial; return [slots[index], value => { slots[index] = typeof value === 'function' ? value(slots[index]) : value; }]; },
      useEffect(run, deps) { const index = slot++, previous = slots[index]; if (!previous || deps.some((value, i) => !Object.is(value, previous.deps[i]))) { previous?.cleanup?.(); slots[index] = { deps }; pending.push(() => { slots[index].cleanup = run(); }); } },
    };
    if (name.includes('usePermission')) return { usePermission: () => canPlan };
    if (name.includes('productionViewState')) return viewState;
    if (name.includes('productionLifecycleApi')) return {
      getProductionReadiness: async (...args) => { reads.push(args); return data; },
      commandProductionLifecycle: async (...args) => { writes.push(args); return { saved: true }; },
    };
    return controls;
  }).ReadinessPanel;
  const render = () => { slot = 0; const tree = component({ plan: { id: 'plan-A', version: 3, month: '2026-09', batches: [] } }); const effects = pending; pending = []; effects.forEach(run => run()); return tree; };
  render();
  return { replaceData: values => { data = { ...data, ...values }; }, reads, writes, render, destroy: () => slots.forEach(value => value?.cleanup?.()) };
}
const button = (tree, label) => nodes(tree).find(row => row.type === 'Button' && (row.props['aria-label'] === label || content(row) === label));

test('库存齐套中心的核对入口沿用需求日期，无效日期回退默认值', async () => {
  const valid = fixture({ query: 'readinessDate=2026-09-30' }); await flush();
  assert.equal(valid.reads[0][1], '2026-09-30'); valid.destroy();
  const invalid = fixture({ query: 'readinessDate=2026-02-31' }); await flush();
  assert.equal(invalid.reads[0][1], '2026-09-28'); invalid.destroy();
});

test('共享采购从齐套明细分配，编辑器说明净未到和上限，并提交打开时的订单、计划及来源依据', async () => {
  const f = fixture(); await flush();
  assert.match(content(f.render()), /未分配订单不计预计覆盖/);
  button(f.render(), '调整 PO-60 采购分配').props.onClick();
  const editor = nodes(f.render()).find(row => row.type === 'OperationalDialog').props.editor;
  assert.match(editor.description, /净未到 60 件/); assert.match(editor.description, /其他范围已确认分配 20/); assert.match(editor.description, /最多可分配 40/); assert.match(editor.description, /0 为释放/);
  assert.equal(editor.fields[0].value, '0');
  // A later view update must not silently substitute a different confirmation basis for an open draft.
  f.replaceData({ sourceToken: 'later-view', planVersion: 4 });
  button(f.render(), '刷新依据').props.onClick(); f.render(); await flush();
  await editor.submit({ quantity: '40', reason: '计划核对', code: 'forged', orderId: 'forged' }, 'request-ui-000001');
  assert.deepEqual(f.writes[0], ['plan-A', 'readiness', { action: 'purchase', requestId: 'request-ui-000001', version: 3,
    data: { quantity: '40', reason: '计划核对', code: 'M1', orderId: 'po-line-1', date: '2026-09-28', batchId: '', sourceToken: 'read-basis-1' } }]);
  f.destroy();
});

test('过期分配可重新确认或填零释放；只读人员和历史快照不提供修改入口', async () => {
  const stale = fixture({ status: 'stale', canAllocate: false, assignedQty: 50 }); await flush();
  button(stale.render(), '重新确认 PO-60 采购分配').props.onClick();
  const editor = nodes(stale.render()).find(row => row.type === 'OperationalDialog').props.editor;
  assert.equal(editor.title, '重新确认采购分配'); assert.equal(editor.fields[0].value, '50'); assert.match(editor.description, /最多可分配 0/);
  await editor.submit({ quantity: '0', reason: '来源变化释放' }, 'request-ui-000002');
  assert.equal(stale.writes[0][2].data.quantity, '0'); stale.destroy();
  const readOnly = fixture({ canPlan: false }); await flush();
  assert.equal(button(readOnly.render(), '调整 PO-60 采购分配'), undefined); readOnly.destroy();
  const history = fixture(); await flush(); button(history.render(), '查看当时依据').props.onClick(); history.render(); await flush();
  assert.equal(history.reads.at(-1)[3], 'snapshot-1'); assert.equal(button(history.render(), '调整 PO-60 采购分配'), undefined);
  history.destroy();
});
