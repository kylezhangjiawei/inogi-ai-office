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
    React, QualityRecordsPanel: 'QualityRecordsPanel', useId: () => 'verification-form', requestAnimationFrame: (callback) => callback(),
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

test('已有填写的报工关闭时先确认，取消放弃仍保留输入', async () => {
  const f=await readyEditor(); change(f,'班次','白班');
  find(f.render(),node=>node.type==='Dialog').props.onOpenChange(false);
  assert.equal(f.saved.includes('closed'),false);
  const confirm=find(f.render(),node=>node.type==='AlertDialog'); assert.equal(confirm.props.open,true);
  confirm.props.onOpenChange(false);
  assert.equal(find(find(f.render(),node=>node.type==='Field'&&node.props.label==='班次'),node=>node.type==='Input').props.value,'白班');
});

test('报工请求失败重试沿用提交标识，防止成功响应丢失后的重复登记', async () => {
  const writes=[];
  const f=await readyEditor({}, { saveProductionReport: async (...args)=>{writes.push(args);if(writes.length===1)throw Error('响应中断');return{};} });
  fillProduction(f); await submit(f); await submit(f);
  assert.match(writes[0][1].requestId,/^[A-Za-z0-9_-]{16,128}$/);
  assert.equal(writes[0][1].requestId,writes[1][1].requestId);
});

test('未登记不良带入原报工、单位、计划和差额，保持实际批次待填写', async () => {
  const sourceReport={id:'report-1',stockPlanId:'plan-1',unit:'件',unregisteredDefectiveQty:2,unregisteredInspectedQty:60};
  const f=await readyEditor({editor:{kind:'quality',sourceReport}});
  const value=label=>find(find(f.render(),n=>n.type==='Field'&&n.props.label===label),n=>['Input','NativeSelect'].includes(n.type)).props.value;
  assert.equal(value('数量单位'),'件');assert.equal(value('不良来源'),'production');assert.equal(value('关联生产报工'),'report-1');
  assert.equal(value('检验数量'),'60');assert.equal(value('不良数量'),'2');assert.equal(value('批次编号'),'');
});

test('同范围保存刷新保留质量面板，默认请求跨月待闭环数据', async () => {
  const waiting=deferred(); const calls=[];
  const f=fixture('SubsystemOperationsPanel',{productId:'p-1',treeNodeId:'n-1'},{getProcurementOperations:async scope=>{calls.push(scope);return calls.length===1?data:waiting.promise;}});
  f.render();await settle();find(f.render(),n=>n.type==='Tabs').props.onValueChange('quality');
  const panel=find(f.render(),n=>n.type==='QualityRecordsPanel');assert.ok(panel);assert.equal(calls[0].qualityView,'pending');
  panel.props.onSaved();f.render();const refreshing=find(f.render(),n=>n.type==='QualityRecordsPanel');
  assert.ok(refreshing);assert.equal(refreshing.key,panel.key); waiting.resolve(data);await settle();
});

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
    useState: (initial) => [stateIndex++ === 1 ? { item: { warehouses, stock: 1000, in: 0 } } : initial, () => {}],
    useI18n: () => ({ t: translate }), usePermission: () => false, useProcTaskAction: () => ({ modal: null }),
    useSearchParams: () => [new URLSearchParams(), () => {}], useLocation: () => ({ state: null }),
    cn: (...values) => values.filter(Boolean).join(' '), formatQuantity: String,
  };
  for (const name of ['Button', 'ArrowLeft', 'AutoTranslatedText', 'Boxes', 'ClipboardList', 'RefreshCw', 'InventoryStat', 'PackageCheck', 'Truck', 'Warehouse', 'ComponentInventoryValue', 'ComponentInventoryEditor']) bindings[name] = name;
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

// BOM maintenance moved to the device page. Its current identity/version, double-submit,
// conflict, validation, library failure and unmount protections run in bom-page.test.mjs.
// Aggregated readiness rows are read-only; do not resurrect their retired free-text editor.

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
