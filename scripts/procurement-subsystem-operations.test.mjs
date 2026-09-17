import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import React from 'react';
import ts from 'typescript';

const source = readFileSync(new URL('../src/app/procurement/components/SubsystemOperationsPanel.tsx', import.meta.url), 'utf8');
const ast = ts.createSourceFile('SubsystemOperationsPanel.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
function getFunction(name, sourceAst = ast) {
  const node = sourceAst.statements.find((item) => ts.isFunctionDeclaration(item) && item.name?.text === name);
  assert.ok(node, `missing ${name}`);
  return ts.transpileModule(`${node.getText(sourceAst).replace(/^export\s+/, '')}\nreturn ${name};`, { compilerOptions: { jsx: ts.JsxEmit.React, target: ts.ScriptTarget.ES2022 } }).outputText;
}
const options = { plans: [{ id: 'plan-1', code: 'SP-1', unit: '套', materialId: null }], tasks: [], materials: [], suppliers: [], productionReports: [] };
const data = { month: '2026-09', productionReports: [], qualityRecords: [], productionSummary: [], qualitySummary: [] };
const settle = () => new Promise((resolve) => setImmediate(resolve));
function deferred() { let resolve; let reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }

function fixture(name, props, overrides = {}, sourceAst = ast) {
  const slots = []; let cursor = 0; const effects = []; const saved = []; const requests = [];
  const bindings = {
    React, useId: () => 'verification-form', requestAnimationFrame: (callback) => callback(),
    useState(initial) { const index = cursor++; if (!(index in slots)) slots[index] = typeof initial === 'function' ? initial() : initial; return [slots[index], (value) => { slots[index] = typeof value === 'function' ? value(slots[index]) : value; }]; },
    useRef(initial) { const index = cursor++; if (!(index in slots)) slots[index] = { current: initial }; return slots[index]; },
    useEffect(callback, deps) { const index = cursor++; const prev = slots[index]; if (!prev || deps.some((dep, i) => dep !== prev.deps[i])) { if (prev?.cleanup) prev.cleanup(); slots[index] = { deps }; effects.push(() => { slots[index].cleanup = callback(); }); } },
    useI18n: () => ({ t: translate }), usePermission: () => true,
    today: () => '2026-09-04', quantity: String, percent: (n) => n === null ? '—' : `${n}%`, selectClass: '',
    sourceLabels: { procurement: '采购不良', production: '生产不良' }, statusLabels: { open: '待处理', processing: '处理中', closed: '已关闭' }, dispositionLabels: { pending: '待判定', return: '退货', rework: '返工', scrap: '报废', concession: '让步接收', replacement: '换货' },
    toast: { success: () => {} },
    getProcurementOperationsOptions: async () => options,
    getProcurementOperations: async () => data,
    saveProductionReport: async (...args) => { requests.push(args); return {}; },
    saveQualityRecord: async (...args) => { requests.push(args); return {}; },
    saveInventoryBomLine: async (...args) => { requests.push(['save-bom', ...args]); return {}; },
    deleteInventoryBomLine: async (...args) => { requests.push(['delete-bom', ...args]); return {}; },
    getQualityVerifications: async () => [],
    verifyQualityRecord: async (...args) => { requests.push(args); return {}; },
    reopenQualityRecord: async (...args) => { requests.push(args); return {}; },
    ...overrides,
  };
  for (const component of ['QualityVerificationDialog', 'AlertDialog', 'AlertDialogAction', 'AlertDialogCancel', 'AlertDialogContent', 'AlertDialogDescription', 'AlertDialogFooter', 'AlertDialogHeader', 'AlertDialogTitle', 'Label', 'NativeSelect', 'Button', 'Dialog', 'DialogContent', 'DialogDescription', 'DialogFooter', 'DialogHeader', 'DialogTitle', 'Input', 'Textarea', 'Tabs', 'TabsList', 'TabsTrigger', 'Field', 'Stat', 'Empty', 'OperationsEditor', 'AlertTriangle', 'BarChart3', 'ClipboardCheck', 'Factory', 'Loader2', 'Pencil', 'Plus', 'RefreshCw']) bindings[component] = component;
  const component = new Function(...Object.keys(bindings), getFunction(name, sourceAst))(...Object.values(bindings));
  const input = { onSaved: () => saved.push('saved'), onClose: () => saved.push('closed'), ...props };
  return { requests, saved, render() { cursor = 0; const tree = component(input); while (effects.length) effects.shift()(); return tree; }, destroy() { for (const slot of slots) slot?.cleanup?.(); } };
}
function translate(value, vars = {}) { return value.replace(/\{(\w+)\}/g, (_, key) => vars[key] ?? key); }
function find(tree, predicate) { if (!tree || typeof tree !== 'object') return null; if (predicate(tree)) return tree; for (const child of React.Children.toArray(tree.props?.children)) { const found = find(child, predicate); if (found) return found; } return null; }
function all(tree, predicate, out = []) { if (!tree || typeof tree !== 'object') return out; if (predicate(tree)) out.push(tree); for (const child of React.Children.toArray(tree.props?.children)) all(child, predicate, out); return out; }
function change(f, label, value) { const field = find(f.render(), (node) => node.type === 'Field' && node.props.label === label); assert.ok(field, `missing field ${label}`); const input = find(field, (node) => ['Input', 'Textarea', "NativeSelect"].includes(node.type)); input.props.onChange({ target: { value } }); }
function submit(f) { return find(f.render(), (node) => node.type === 'form').props.onSubmit({ preventDefault() {} }); }
async function readyEditor(extra = {}, overrides = {}) {
  const f = fixture('OperationsEditor', { scope: { productId: 'p-1', treeNodeId: 'n-1', stockPlanId: 'plan-1' }, editor: { kind: 'production' }, ...extra }, overrides);
  f.render(); await settle(); return f;
}
function fillProduction(f) { for (const [label, value] of [['班次', '白班'], ['产线或工序', '装配'], ['计划产量', '10'], ['实际产量', '9'], ['良品数量', '8'], ['投入工时（人时）', '2']]) change(f, label, value); }

test('产品汇总即使有写权限也没有登记入口；具体子系统才可登记', async () => {
  const global = fixture('SubsystemOperationsPanel', { productId: 'p-1' }); global.render(); await settle();
  assert.equal(all(global.render(), (node) => node.type === 'Button' && React.Children.toArray(node.props.children).includes('登记报工')).length, 0);
  const local = fixture('SubsystemOperationsPanel', { productId: 'p-1', treeNodeId: 'n-1' }); local.render(); await settle();
  assert.equal(all(local.render(), (node) => node.type === 'Button' && React.Children.toArray(node.props.children).includes('登记报工')).length, 1);
});

test('保存异步等待，连续双击仅一笔；期间关闭和Escape均被阻止', async () => {
  const waiting = deferred(); const requests = [];
  const f = await readyEditor({}, { saveProductionReport: (...args) => { requests.push(args); return waiting.promise; } });
  fillProduction(f);
  const first = submit(f); const second = submit(f);
  assert.equal(requests.length, 1); assert.equal(requests[0][1].capacityQty, null);
  const view = f.render();
  assert.equal(find(view, (node) => node.type === 'fieldset').props.disabled, true);
  find(view, (node) => node.type === 'Dialog').props.onOpenChange(false);
  const event = { prevented: false, preventDefault() { this.prevented = true; } };
  find(view, (node) => node.type === 'DialogContent').props.onEscapeKeyDown(event);
  assert.equal(event.prevented, true); assert.deepEqual(f.saved, []);
  waiting.resolve({}); await Promise.all([first, second]);
  assert.deepEqual(f.saved, ['saved']);
});

test('保存失败留在表单并保留原输入，可重试', async () => {
  let count = 0;
  const f = await readyEditor({}, { saveProductionReport: async () => { count++; if (count === 1) throw new Error('网络暂时不可用'); return {}; } });
  fillProduction(f); await submit(f);
  assert.ok(find(f.render(), (node) => node.props?.role === 'alert'));
  assert.equal(find(find(f.render(), (node) => node.type === 'Field' && node.props.label === '实际产量'), (node) => node.type === 'Input').props.value, '9');
  assert.deepEqual(f.saved, []);
  await submit(f); assert.equal(count, 2); assert.deepEqual(f.saved, ['saved']);
});

test('旧模块保存晚返回不会关闭或刷新新模块', async () => {
  const waiting = deferred();
  const f = await readyEditor({}, { saveProductionReport: () => waiting.promise });
  fillProduction(f); const pending = submit(f); f.destroy(); waiting.resolve({}); await pending;
  assert.deepEqual(f.saved, []);
});

test('普通表单禁止关闭，处置保存保留乐观锁版本', async () => {
  const record = { id: 'q-1', stockPlanId: 'plan-1', unit: '套', source: 'production', batchNo: 'B-1', inspectionDate: '2026-09-04', inspectedQty: 9, defectiveQty: 1, issue: '划痕', disposition: 'pending', status: 'open', updatedAt: '2026-09-04T01:00:00Z' };
  const f = await readyEditor({ editor: { kind: 'quality', record } });
  change(f, '处理状态', 'closed'); await submit(f);
  assert.equal(f.requests.length, 0); assert.ok(find(f.render(), (node) => node.props?.role === 'alert'));
  change(f, '处置方式', 'rework'); change(f, '处理结果', '返工并复验合格'); await submit(f);
  assert.equal(f.requests.length, 0);
  change(f, '处理状态', 'processing'); await submit(f);
  assert.equal(f.requests.length, 1); assert.equal(f.requests[0][1].status, 'processing'); assert.equal(f.requests[0][1].resolution, '返工并复验合格'); assert.equal(f.requests[0][1].baseUpdatedAt, record.updatedAt);
});

test('关联信息失败有重试，不显示可提交的空选项表单', async () => {
  const f = await readyEditor({}, { getProcurementOperationsOptions: async () => { throw new Error('关联数据读取失败'); } });
  assert.equal(find(f.render(), (node) => node.type === 'form'), null);
  assert.ok(find(f.render(), (node) => node.props?.role === 'alert'));
  assert.ok(find(f.render(), (node) => node.type === 'Button' && node.props.children === '重试加载关联信息'));
});

const moduleSource = readFileSync(new URL('../src/app/procurement/components/ProcurementModuleDetail.tsx', import.meta.url), 'utf8');
const moduleAst = ts.createSourceFile('ProcurementModuleDetail.tsx', moduleSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const moduleFunction = getFunction('ProcurementModuleDetail', moduleAst);
function renderModuleInventory(warehouses) {
  let stateIndex = 0;
  const bindings = {
    React, useMemo: (compute) => compute(), useCallback: (callback) => callback, useEffect: () => {},
    useState: (initial) => [stateIndex++ === 0 ? { item: { warehouses, stock: 1000, in: 0 } } : initial, () => {}],
    useI18n: () => ({ t: translate }), usePermission: () => false, useProcTaskAction: () => ({ modal: null }),
    useSearchParams: () => [new URLSearchParams(), () => {}], useLocation: () => ({ state: null }),
    cn: (...values) => values.filter(Boolean).join(' '), formatQuantity: String,
  };
  for (const name of ['Button', 'ArrowLeft', 'AutoTranslatedText', 'Boxes', 'ClipboardList', 'RefreshCw', 'InventoryStat', 'PackageCheck', 'Truck', 'Warehouse']) bindings[name] = name;
  const component = new Function(...Object.keys(bindings), moduleFunction)(...Object.values(bindings));
  return component({ materials: [{ id: 'm-1', name: '测试物料', unit: '件', tpInventoryCode: 'ERP-1' }], node: { id: 'n-1', materialId: 'm-1', productId: 'p-1', name: '子系统', taskIds: [] }, productName: '测试产品', tasks: [], onBack: () => {} });
}

test('子系统量产可用量包含带状态前缀的 861 件，排除研发量产仓和不良品仓', () => {
  const warehouses = [
    { name: '【活】量产仓', available: 861, stock: 861, inTransit: 0 },
    { name: '【活】研发量产仓', available: 500, stock: 500, inTransit: 0 },
    { name: '【活】不良品仓', available: 70, stock: 70, inTransit: 0 },
  ];
  const view = renderModuleInventory(warehouses);
  assert.equal(find(view, (node) => node.type === 'InventoryStat' && node.props.label === '量产仓可用量').props.value, 861);
  assert.equal(all(view, (node) => node.type === 'td' && warehouses.some((warehouse) => warehouse.name === node.props.children)).length, 3, '其他仓库仍保留在明细表中');
});

test('子系统量产仓匹配口径与 API 一致，不把相似名称或多个前缀算作量产仓', () => {
  const apiSource = readFileSync(new URL('../apps/api/src/modules/procurement/inventory-readiness.ts', import.meta.url), 'utf8');
  const apiAst = ts.createSourceFile('inventory-readiness.ts', apiSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const isProductionWarehouse = new Function(getFunction('isProductionWarehouse', apiAst))();
  for (const [name, expected] of [
    ['量产仓', 1], ['量产仓库', 1], [' 【活】 量产 仓 库\t', 1],
    ['研发量产仓', 0], ['【活】研发量产仓', 0], ['【活】不良品仓', 0],
    ['量产仓-测试', 0], ['前缀量产仓', 0], ['【活】【状态】量产仓', 0], ['', 0],
  ]) {
    const view = renderModuleInventory([{ name, available: 1, stock: 1, inTransit: 0 }]);
    const actual = find(view, (node) => node.type === 'InventoryStat' && node.props.label === '量产仓可用量').props.value;
    assert.equal(actual, expected, name);
    assert.equal(actual, Number(isProductionWarehouse(name)), `API 仓库口径：${name}`);
  }
});

const inventorySource = readFileSync(new URL('../src/app/procurement/InventoryReadinessPage.tsx', import.meta.url), 'utf8');
const inventoryAst = ts.createSourceFile('InventoryReadinessPage.tsx', inventorySource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const bomLineA = { id: 'bom-leaf-a', name: '密封圈', code: 'M-001', qtyPer: 0.125, remark: '主机用料', parentId: 'position-a', category: '密封件', bomPosition: '气路组件', updatedAt: '2026-09-04T01:02:03.004Z', unit: '件' };
const bomLineB = { ...bomLineA, id: 'bom-leaf-b', qtyPer: 2.75, remark: '另一处用料', parentId: 'position-b', bomPosition: '阀体组件', updatedAt: '2026-09-05T02:03:04.005Z' };
function controlledTimers() {
  let now = 0; let nextId = 0; const timers = new Map();
  return {
    setTimeout(callback, delay) { const id = ++nextId; timers.set(id, { callback, at: now + delay }); return id; },
    clearTimeout(id) { timers.delete(id); },
    advance(ms) {
      const end = now + ms;
      while (true) {
        const next = [...timers].filter(([, timer]) => timer.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
        if (!next) break;
        const [id, timer] = next; now = timer.at; timers.delete(id); timer.callback();
      }
      now = end;
    },
    get pending() { return timers.size; },
  };
}
function bomEditor(mode, lines = [], overrides = {}) {
  const clock = controlledTimers(); const lookups = [];
  const f = fixture('InventoryBomEditor', { editor: { mode, lines }, positions: [{ id: 'position-a', name: '气路组件' }, { id: 'position-b', name: '阀体组件' }] }, {
    setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout,
    getInventoryMaterialReference: async (code, signal) => { lookups.push({ code, signal }); return { matched: true, category: '密封件', unit: '件' }; },
    ...overrides,
  }, inventoryAst);
  f.render();
  return { ...f, clock, lookups };
}
function bomInput(f, label) {
  const input = find(f.render(), (node) => ['Input', 'Textarea', "NativeSelect"].includes(node.type) && node.props['aria-label'] === label);
  assert.ok(input, `missing BOM field: ${label}`);
  return input;
}
function changeBom(f, label, value) { bomInput(f, label).props.onChange({ target: { value } }); }
function fillBom(f) { changeBom(f, '物料名称', '  新密封圈  '); changeBom(f, '物料编码', '  M-NEW  '); changeBom(f, '单机用量', '1.2345'); changeBom(f, '备注', '  装配所需  '); }

test('通用物料新建提交清理后的名称、编码和四位小数用量，不携带旧记录ID或版本', async () => {
  const f = bomEditor('create');
  fillBom(f); await submit(f);
  assert.deepEqual(f.requests, [['save-bom', { name: '新密封圈', code: 'M-NEW', qtyPer: 1.2345, parentId: null, remark: '装配所需' }, undefined]]);
  assert.deepEqual(f.saved, ['saved']);
});

test('通用物料编辑保留来源原始用量与精确版本，不改写成齐套列表汇总数量', async () => {
  const f = bomEditor('edit', [bomLineA]);
  assert.equal(bomInput(f, '单机用量').props.value, '0.125');
  assert.equal(bomInput(f, 'BOM 所属位置').props.value, 'position-a');
  changeBom(f, '物料名称', '新名称'); await submit(f);
  assert.deepEqual(f.requests, [['save-bom', { name: '新名称', code: 'M-001', qtyPer: 0.125, parentId: 'position-a', remark: '主机用料', baseUpdatedAt: bomLineA.updatedAt }, bomLineA.id]]);
});

test('多来源汇总必须明确选择一个来源，只提交选中的原始用量、ID与版本', async () => {
  const f = bomEditor('edit', [bomLineA, bomLineB]);
  assert.equal(bomInput(f, '物料来源').props.value, '');
  assert.equal(find(f.render(), (node) => node.type === 'Input' && node.props['aria-label'] === '单机用量'), null);
  assert.equal(find(f.render(), (node) => node.type === 'Button' && node.props.type === 'submit').props.disabled, true);
  await submit(f); assert.equal(f.requests.length, 0);
  changeBom(f, '物料来源', bomLineB.id);
  assert.equal(bomInput(f, '单机用量').props.value, '2.75');
  assert.equal(bomInput(f, '备注').props.value, '另一处用料');
  await submit(f);
  assert.equal(f.requests.length, 1);
  assert.equal(f.requests[0][2], bomLineB.id);
  assert.equal(f.requests[0][1].qtyPer, 2.75);
  assert.notEqual(f.requests[0][1].qtyPer, bomLineA.qtyPer + bomLineB.qtyPer);
  assert.equal(f.requests[0][1].baseUpdatedAt, bomLineB.updatedAt);
  assert.equal(f.requests[0][1].parentId, bomLineB.parentId);
});

test('切换物料来源重新带入该来源字段，不把前一来源草稿写到另一条记录', async () => {
  const f = bomEditor('edit', [bomLineA, bomLineB]);
  changeBom(f, '物料来源', bomLineA.id);
  changeBom(f, '单机用量', '999'); changeBom(f, '备注', '第一条未保存草稿');
  changeBom(f, '物料来源', bomLineB.id);
  assert.equal(bomInput(f, '单机用量').props.value, '2.75');
  assert.equal(bomInput(f, '备注').props.value, bomLineB.remark);
  await submit(f);
  assert.equal(f.requests[0][1].qtyPer, bomLineB.qtyPer);
  assert.equal(f.requests[0][1].remark, bomLineB.remark);
});

test('删除多来源物料时只删除明确选中的叶子ID并携带它的版本', async () => {
  const f = bomEditor('delete', [bomLineA, bomLineB]);
  await submit(f); assert.deepEqual(f.requests, []);
  changeBom(f, '物料来源', bomLineB.id);
  assert.ok(find(f.render(), (node) => node.type === 'p' && node.props.children === '仅删除以上来源，其余 1 条来源保留。'));
  await submit(f);
  assert.deepEqual(f.requests, [['delete-bom', bomLineB.id, bomLineB.updatedAt]]);
  assert.deepEqual(f.saved, ['saved']);
});

test('通用物料保存双击只有一个请求，等待期间阻止取消、Escape和点外部关闭', async () => {
  const waiting = deferred(); const writes = [];
  const f = bomEditor('edit', [bomLineA], { saveInventoryBomLine: (...args) => { writes.push(args); return waiting.promise; } });
  const callback = find(f.render(), (node) => node.type === 'form').props.onSubmit;
  const first = callback({ preventDefault() {} }); const second = callback({ preventDefault() {} });
  assert.equal(writes.length, 1);
  const view = f.render();
  assert.equal(find(view, (node) => node.type === 'fieldset').props.disabled, true);
  assert.equal(find(view, (node) => node.type === 'Button' && node.props.type === 'submit').props.disabled, true);
  find(view, (node) => node.type === 'Dialog').props.onOpenChange(false);
  find(view, (node) => node.type === 'Button' && node.props.children === '取消').props.onClick();
  for (const handler of ['onEscapeKeyDown', 'onPointerDownOutside']) {
    const event = { prevented: false, preventDefault() { this.prevented = true; } };
    find(view, (node) => node.type === 'DialogContent').props[handler](event);
    assert.equal(event.prevented, true, handler);
  }
  assert.deepEqual(f.saved, []);
  waiting.resolve({}); await Promise.all([first, second]);
  assert.deepEqual(f.saved, ['saved']);
});

test('通用物料删除双击只有一次精确删除，等待期间不能切换被删来源', async () => {
  const waiting = deferred(); const deletes = [];
  const f = bomEditor('delete', [bomLineA, bomLineB], { deleteInventoryBomLine: (...args) => { deletes.push(args); return waiting.promise; } });
  changeBom(f, '物料来源', bomLineA.id);
  const callback = find(f.render(), (node) => node.type === 'form').props.onSubmit;
  const first = callback({ preventDefault() {} }); const second = callback({ preventDefault() {} });
  assert.deepEqual(deletes, [[bomLineA.id, bomLineA.updatedAt]]);
  assert.equal(bomInput(f, '物料来源').props.disabled, true);
  waiting.resolve({}); await Promise.all([first, second]);
  assert.deepEqual(f.saved, ['saved']);
});

test('通用物料保存失败保留修改后的输入和来源版本，可重试且成功前不关闭', async () => {
  const writes = [];
  const f = bomEditor('edit', [bomLineA], { saveInventoryBomLine: async (...args) => { writes.push(args); if (writes.length === 1) throw new Error('版本冲突，请刷新后重试'); return {}; } });
  changeBom(f, '物料名称', '调整后的名称'); changeBom(f, '单机用量', '0.375'); changeBom(f, '备注', '仍需保留的草稿');
  await submit(f);
  assert.equal(find(f.render(), (node) => node.props?.role === 'alert').props.children, '版本冲突，请刷新后重试');
  assert.equal(bomInput(f, '物料名称').props.value, '调整后的名称');
  assert.equal(bomInput(f, '单机用量').props.value, '0.375');
  assert.equal(bomInput(f, '备注').props.value, '仍需保留的草稿');
  assert.deepEqual(f.saved, []);
  await submit(f);
  assert.equal(writes.length, 2); assert.deepEqual(writes[1], writes[0]);
  assert.equal(writes[1][0].baseUpdatedAt, bomLineA.updatedAt);
  assert.deepEqual(f.saved, ['saved']);
});

test('通用物料编辑器销毁后，保存或删除的迟到响应不再关闭页面或触发刷新', async () => {
  for (const mode of ['edit', 'delete']) {
    const waiting = deferred();
    const f = bomEditor(mode, [bomLineA], { saveInventoryBomLine: () => waiting.promise, deleteInventoryBomLine: () => waiting.promise });
    const pending = submit(f); f.destroy(); waiting.resolve({}); await pending;
    assert.deepEqual(f.saved, [], mode);
  }
});

test('通用物料非法用量在提交位置报错，不发起保存请求', async () => {
  for (const value of ['', '0', '-1', '1.00001', '10000000000', 'NaN']) {
    const f = bomEditor('edit', [bomLineA]); changeBom(f, '单机用量', value); await submit(f);
    assert.deepEqual(f.requests, [], value);
    assert.ok(find(f.render(), (node) => node.props?.role === 'alert'), value);
  }
});

test('物料分类只读并按去空白后的编码延迟读取，不把 BOM 位置当成分类', async () => {
  const waiting = deferred(); const reads = [];
  const f = bomEditor('create', [], { getInventoryMaterialReference: (code, signal) => { reads.push({ code, signal }); return waiting.promise; } });
  assert.equal(bomInput(f, '物料分类').props.readOnly, true);
  assert.equal(bomInput(f, '物料分类').props.onChange, undefined);
  assert.equal(bomInput(f, '物料分类').props.value, '输入物料编码后自动带出');
  assert.equal(f.clock.pending, 0);
  changeBom(f, 'BOM 所属位置', 'position-b');
  changeBom(f, '物料编码', '  M-001  ');
  assert.equal(bomInput(f, '物料分类').props.value, '正在读取物料分类…');
  f.clock.advance(219); assert.equal(reads.length, 0);
  f.clock.advance(1); assert.equal(reads.length, 1);
  assert.equal(reads[0].code, 'M-001'); assert.equal(reads[0].signal.aborted, false);
  assert.equal(bomInput(f, '物料分类').props.value, '正在读取物料分类…');
  waiting.resolve({ matched: true, category: '物料库密封件', unit: '个' }); await settle();
  assert.equal(bomInput(f, '物料分类').props.value, '物料库密封件');
  assert.equal(bomInput(f, 'BOM 所属位置').props.value, 'position-b');
  assert.deepEqual(f.requests, []);
});

test('更改编码立即移除旧分类，取消旧查询并忽略乱序返回', async () => {
  const reads = [];
  const f = bomEditor('edit', [bomLineA], { getInventoryMaterialReference: (code, signal) => { const response = deferred(); reads.push({ code, signal, response }); return response.promise; } });
  f.clock.advance(220); assert.equal(reads[0].code, bomLineA.code);
  changeBom(f, '物料编码', 'M-002');
  assert.equal(bomInput(f, '物料分类').props.value, '正在读取物料分类…');
  assert.equal(reads[0].signal.aborted, true);
  f.clock.advance(220); assert.equal(reads[1].code, 'M-002');
  reads[1].response.resolve({ matched: true, category: '新编码分类', unit: '件' }); await settle();
  assert.equal(bomInput(f, '物料分类').props.value, '新编码分类');
  reads[0].response.resolve({ matched: true, category: '旧编码分类', unit: '件' }); await settle();
  assert.equal(bomInput(f, '物料分类').props.value, '新编码分类');
  changeBom(f, '物料编码', 'M-003');
  assert.equal(bomInput(f, '物料分类').props.value, '正在读取物料分类…', '已有成功分类也不能留在新编码上');
  f.clock.advance(100);
  changeBom(f, '物料编码', 'M-004'); f.render();
  f.clock.advance(219); assert.equal(reads.length, 2);
  f.clock.advance(1); assert.equal(reads.length, 3); assert.equal(reads[2].code, 'M-004');
  changeBom(f, '物料编码', '  ');
  assert.equal(bomInput(f, '物料分类').props.value, '输入物料编码后自动带出');
  assert.equal(reads[2].signal.aborted, true);
  reads[2].response.resolve({ matched: true, category: '已清空编码分类', unit: '件' }); await settle();
  f.clock.advance(1000);
  assert.equal(reads.length, 3);
  assert.equal(bomInput(f, '物料分类').props.value, '输入物料编码后自动带出');
});

test('未匹配物料库明确提示，不回退到旧分类或 BOM 所属位置', async () => {
  const f = bomEditor('edit', [bomLineA], { getInventoryMaterialReference: async () => ({ matched: false, category: '', unit: '件' }) });
  f.clock.advance(220); await settle();
  assert.equal(bomInput(f, '物料分类').props.value, '未匹配物料库');
  assert.equal(bomInput(f, 'BOM 所属位置').props.value, bomLineA.parentId);
  assert.equal(find(f.render(), (node) => node.type === "NativeSelect" && node.props['aria-label'] === '所属分类'), null);
});

test('分类读取失败显示原因并允许重试，同编码重试成功后仍保留编辑草稿', async () => {
  const reads = [];
  const f = bomEditor('edit', [bomLineA], { getInventoryMaterialReference: async (code, signal) => { reads.push({ code, signal }); if (reads.length === 1) throw new Error('物料库连接失败'); return { matched: true, category: '重试后物料分类', unit: '件' }; } });
  changeBom(f, '物料名称', '未保存名称'); changeBom(f, '单机用量', '0.375'); changeBom(f, '备注', '分类读取期间的草稿');
  f.clock.advance(220); await settle();
  assert.equal(bomInput(f, '物料分类').props.value, '读取失败');
  const alert = find(f.render(), (node) => node.props?.role === 'alert');
  assert.ok(React.Children.toArray(alert.props.children).includes('物料库连接失败'));
  const retry = find(alert, (node) => node.type === "Button" && node.props.children === '重试读取分类');
  assert.ok(retry); retry.props.onClick();
  assert.equal(bomInput(f, '物料分类').props.value, '正在读取物料分类…');
  assert.equal(reads[0].signal.aborted, true);
  f.clock.advance(219); assert.equal(reads.length, 1);
  f.clock.advance(1); await settle();
  assert.equal(reads.length, 2); assert.equal(reads[1].code, bomLineA.code);
  assert.equal(bomInput(f, '物料分类').props.value, '重试后物料分类');
  assert.equal(find(f.render(), (node) => node.props?.role === 'alert'), null);
  assert.equal(bomInput(f, '物料名称').props.value, '未保存名称');
  assert.equal(bomInput(f, '单机用量').props.value, '0.375');
  assert.equal(bomInput(f, '备注').props.value, '分类读取期间的草稿');
  assert.deepEqual(f.requests, []); assert.deepEqual(f.saved, []);
});

test('新建和编辑仅保存 BOM 位置 parentId，不把查询出的分类或单位写入 BOM', async () => {
  for (const mode of ['create', 'edit']) {
    const f = bomEditor(mode, mode === 'edit' ? [bomLineA] : [], { getInventoryMaterialReference: async () => ({ matched: true, category: '物料库专属分类', unit: '套' }) });
    if (mode === 'create') fillBom(f);
    changeBom(f, 'BOM 所属位置', 'position-b'); f.render();
    f.clock.advance(220); await settle();
    assert.equal(bomInput(f, '物料分类').props.value, '物料库专属分类');
    await submit(f);
    const [, payload, id] = f.requests[0];
    assert.equal(payload.parentId, 'position-b', mode);
    assert.equal(id, mode === 'edit' ? bomLineA.id : undefined, mode);
    assert.equal(payload.baseUpdatedAt, mode === 'edit' ? bomLineA.updatedAt : undefined, mode);
    assert.deepEqual(Object.keys(payload).sort(), ['name', 'code', 'qtyPer', 'parentId', 'remark', ...(mode === 'edit' ? ['baseUpdatedAt'] : [])].sort(), mode);
    assert.deepEqual(f.saved, ['saved'], mode);
  }
});

test('未选择来源和删除流程不查询分类，编辑器销毁取消延迟及在途分类查询', async () => {
  for (const mode of ['edit', 'delete']) {
    const f = bomEditor(mode, [bomLineA, bomLineB]);
    f.clock.advance(1000); assert.deepEqual(f.lookups, [], mode);
    changeBom(f, '物料来源', bomLineB.id); f.render();
    if (mode === 'delete') { f.clock.advance(1000); assert.deepEqual(f.lookups, [], '删除仅展示已有物料分类'); }
    else { assert.equal(f.clock.pending, 1); f.destroy(); assert.equal(f.clock.pending, 0); f.clock.advance(1000); assert.deepEqual(f.lookups, []); }
  }
  const waiting = deferred(); let signal;
  const f = bomEditor('edit', [bomLineA], { getInventoryMaterialReference: (_code, requestSignal) => { signal = requestSignal; return waiting.promise; } });
  f.clock.advance(220); f.destroy(); assert.equal(signal.aborted, true);
  waiting.resolve({ matched: true, category: '销毁后的迟到分类', unit: '件' }); await settle();
  assert.deepEqual(f.saved, []);
});

const verificationSource = readFileSync(new URL('../src/app/procurement/components/QualityVerificationDialog.tsx', import.meta.url), 'utf8');
const verificationAst = ts.createSourceFile('QualityVerificationDialog.tsx', verificationSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const verificationRecord = { id: 'quality-1', batchNo: 'B-1', issue: '划痕', defectiveQty: 3, unit: '件', status: 'processing', resolution: '返工完成', inspectionDate: '2026-09-01', updatedAt: '2026-09-02T00:00:00.000Z' };
async function verifierDialog(props = {}, overrides = {}) {
  const f = fixture('QualityVerificationDialog', { record: verificationRecord, canVerify: true, ...props }, overrides, verificationAst);
  f.render(); await settle(); return f;
}
function verificationChange(f, suffix, value) {
  const field = find(f.render(), (node) => node.props?.id === `verification-form-${suffix}`);
  assert.ok(field); field.props.onChange({ target: { value } });
}
test('无验证权限只能查看历史，不提供关闭或重开表单', async () => {
  const f = await verifierDialog({ canVerify: false });
  assert.equal(find(f.render(), (node) => node.type === 'form'), null);
});
test('验证通过先二次确认，提交携带记录版本且验证人不由客户端填写', async () => {
  const f = await verifierDialog();
  verificationChange(f, 'passed', '3'); verificationChange(f, 'evidence', 'QC-01 复验通过');
  await submit(f); assert.equal(f.requests.length, 0);
  assert.ok(find(f.render(), (node) => node.type === 'AlertDialog' && node.props.open));
  find(f.render(), (node) => node.type === 'AlertDialogAction').props.onClick(); await settle();
  assert.equal(f.requests.length, 1); assert.equal(f.requests[0][1].baseUpdatedAt, verificationRecord.updatedAt);
  assert.equal(f.requests[0][1].passedQty, 3); assert.equal('actorId' in f.requests[0][1], false);
});
test('复验失败仍可记录，网络失败保留草稿和相同提交编号安全重试', async () => {
  const calls = [];
  const f = await verifierDialog({}, { verifyQualityRecord: async (...args) => { calls.push(args); if (calls.length === 1) throw new Error('网络暂时不可用'); return {}; } });
  verificationChange(f, 'passed', '2'); verificationChange(f, 'evidence', '尚有一件不合格');
  await submit(f); await settle();
  assert.ok(find(f.render(), (node) => node.props?.role === 'alert'));
  assert.equal(find(f.render(), (node) => node.props?.id === 'verification-form-evidence').props.value, '尚有一件不合格');
  await submit(f); await settle();
  assert.equal(calls.length, 2); assert.equal(calls[0][1].requestId, calls[1][1].requestId);
});
test('复验数量矛盾时不发送请求，关闭记录重新打开须填写原因并确认', async () => {
  const f = await verifierDialog(); verificationChange(f, 'passed', '4'); verificationChange(f, 'evidence', '依据');
  await submit(f); await settle(); assert.equal(f.requests.length, 0);
  const closed = await verifierDialog({ record: { ...verificationRecord, status: 'closed' } });
  verificationChange(closed, 'evidence', '发现遗漏项'); await submit(closed); assert.equal(closed.requests.length, 0);
  find(closed.render(), (node) => node.type === 'AlertDialogAction').props.onClick(); await settle();
  assert.equal(closed.requests[0][1].reason, '发现遗漏项');
});
