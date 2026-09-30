import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import React from 'react';
import * as jsxRuntime from 'react/jsx-runtime';
import ts from 'typescript';
const primitives = new Proxy({}, { get: (_, key) => key });
const readCockpit = file => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
const cockpitSource = readCockpit('src/app/order-processing/pages/warehouseCockpitState.ts');
const cockpitPermissions = evaluate(readCockpit('src/app/lib/permissions.ts'), {});
const cockpitModel = evaluate(cockpitSource, { react: {}, '../../lib/permissions': cockpitPermissions });
const t = (value, args = {}) => value.replace(/\{(\w+)\}/g, (_, key) => args[key] ?? key);
function load(name, deps = {}) {
  let source = readFileSync(new URL(`../src/app/${['WarehouseCockpit', 'WarehouseWorkbench', 'InventoryCountPage', 'ShipmentRecordsPage'].includes(name) ? 'order-processing/pages' : ['WarehouseReturnWorkspace', 'ErpPurchaseReceiptPanel'].includes(name) ? 'procurement/warehouse-flow' : 'procurement'}/${name}.tsx`, import.meta.url), 'utf8');
  if (name === 'WarehouseFlowPage') source += '\nexport { WarehouseFlowWorkspace };';
  if (name === 'WarehouseWorkbench') source += '\nexport { WarehouseWorkbenchContent };';
  if (name === 'InventoryCountPage') source += '\nexport { InventoryCountContent };';
  if (name === 'ShipmentRecordsPage') source += '\nexport { ShipmentRecordsContent };';
  return evaluate(source, deps);
}
function evaluate(source, deps) {
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const exports = {};
  new Function('exports', 'require', code)(exports, key => {
    if (key.includes('/components/')) return primitives;
    if (key.endsWith('.css')) return {};
    assert.ok(key in deps, key); return deps[key];
  }); return exports;
}
const model = evaluate(readFileSync(new URL('../src/app/procurement/warehouse-flow/warehouseViewState.ts', import.meta.url), 'utf8'), {});
const issue = id => ({ id, taskId: id, planId: '2026-09:plan', version: 3, status: 'requested', title: `作业 ${id}`, productLine: 'Q7', neededDate: '2026-09-25', recipientId: 'actor', recipientName: '领料人', lines: [{ code: 'M1', name: '阀体', unit: '件', quantity: 20, issuedQty: 10, signedQty: 5 }], history: [{ id: 'event', action: 'issue', actorName: '仓管', at: '2026-09-20T00:00:00Z', reason: '实物交接', lines: [{ code: 'M1', quantity: 10, warehouse: '量产仓' }] }] });
const record = id => ({ id, kind: 'return', status: 'pending', version: 7, name: `物料 ${id}`, code: 'M1', unit: '件', warehouse: '量产仓', batch: 'B1', date: '2026-09-20', quantity: 5, qualifiedQty: 3, defectiveQty: 1, pendingQty: 1, actorId: 'other', actorName: '填报人', sourceId: 'real-source', events: [{ action: 'return', actorName: '填报人', at: '2026-09-20T00:00:00Z', reason: '真实退料依据' }] });
const flows = { items: Array.from({ length: 25 }, (_, i) => issue(`I${i + 1}`)), canIssue: true, canReconcile: true, balances: [{ code: 'M1', warehouse: '量产仓', unit: '件', available: 40, syncedAt: '2026-09-20T00:00:00Z' }] };
const ledger = { records: Array.from({ length: 25 }, (_, i) => record(`R${i + 1}`)), receipts: [], balances: [] };
const all = (tree, predicate, out = []) => {
  if (!tree || typeof tree !== 'object') return out;
  if (predicate(tree)) out.push(tree);
  React.Children.forEach(tree.props?.children, child => all(child, predicate, out));
  for (const key of ['actions', 'meta']) if (tree.props?.[key]) all(tree.props[key], predicate, out);
  return out;
};
const text = tree => typeof tree === 'string' || typeof tree === 'number' ? String(tree) : !tree || typeof tree !== 'object' ? '' : React.Children.toArray(tree.props?.children).map(text).join(' ');
function fixture(name, initial, api = {}, permissions = ['*']) {
  let params = new URLSearchParams(initial), cursor = 0, dirty = false;
  const slots = [], effects = [], calls = [], writes = [];
  const hooks = {
    useState(initial) { const index = cursor++; if (!(index in slots)) slots[index] = typeof initial === 'function' ? initial() : initial; return [slots[index], next => { slots[index] = typeof next === 'function' ? next(slots[index]) : next; dirty = true; }]; },
    useRef(value) { const index = cursor++; return slots[index] ??= { current: value }; }, useId: () => 'test-id',
    useEffect(effect, deps) { const index = cursor++, old = slots[index]; if (!old || deps.some((value, key) => !Object.is(value, old.deps[key]))) { slots[index] = { deps, cleanup: old?.cleanup }; effects.push(() => { slots[index].cleanup?.(); slots[index].cleanup = effect(); }); } },
  };
  const deps = {
    react: hooks, 'react/jsx-runtime': jsxRuntime, 'lucide-react': primitives,
    'react-router': { Navigate: 'Navigate', Link: 'Link', useSearchParams: () => [params, patch => { params = typeof patch === 'function' ? patch(params) : patch; dirty = true; }] },
    '../auth': { useAuth: () => ({ user: { id: 'actor', permissions } }) }, '../hooks/usePermission': { usePermission: code => permissions.includes('*') || permissions.includes(code) },
    '../lib/i18n': { useI18n: () => ({ t }) }, '../lib/routePaths': { routePath: (_, path) => path, subRoutePath: (_, path, suffix) => `${path}/${suffix}` },
    '../lib/warehouseFlowApi': { getWarehouseFlows: async (...args) => { calls.push(args); return api.flows ? api.flows(...args) : flows; } },
    '../lib/warehouseRecordsApi': { getWarehouseRecords: async (...args) => { calls.push(args); return api.records ? api.records(...args) : ledger; }, commandWarehouseRecord: async input => { writes.push(input); return { id: input.id }; } },
    '../production/execution/OperationalDialog': { OperationalDialog: 'OperationalDialog' },
    './WarehouseRecordsPanel': { WarehouseRecordsPanel: 'WarehouseRecordsPanel' },
    './warehouse-flow/warehouseViewState': model, './warehouse-flow/WarehousePagination': { WarehousePagination: 'WarehousePagination' },
  };
  if (['WarehouseCockpit', 'WarehouseWorkbench', 'InventoryCountPage', 'ShipmentRecordsPage'].includes(name)) {
    for (const key of ['auth', 'lib/i18n', 'lib/routePaths', 'lib/warehouseFlowApi', 'lib/warehouseRecordsApi']) deps[`../../${key}`] = deps[`../${key}`];
    deps['../../lib/permissions'] = cockpitPermissions;
    deps['../../production/execution/OperationalDialog'] = deps['../production/execution/OperationalDialog'];
    deps['../../procurement/WarehouseFlowPage'] = { WarehouseReconcileEditor: 'WarehouseReconcileEditor', WarehouseIssueEditor: 'WarehouseIssueEditor' };
    deps['../../procurement/WarehouseRecordsPanel'] = { WarehouseRecordsPanel: 'WarehouseRecordsPanel' };
    deps['../../procurement/warehouse-flow/warehouseViewState'] = model;
    deps['../../procurement/warehouse-flow/WarehousePagination'] = { WarehousePagination: 'WarehousePagination' };
    deps['./warehouseCockpitState'] = evaluate(cockpitSource, { react: hooks, '../../lib/permissions': cockpitPermissions });
    deps['../../lib/productionExecutionApi'] = { listExecutionPlans: async (...args) => { calls.push(args); return api.plans ? api.plans(...args) : []; } };
    deps['../../production/execution/LifecyclePanel'] = { LifecyclePanel: 'LifecyclePanel' };
  }
  deps['./warehouse-flow/WarehouseReturnWorkspace'] = { WarehouseReturnWorkspace: 'WarehouseReturnWorkspace' };
  deps['./warehouse-flow/ErpPurchaseReceiptPanel'] = { ErpPurchaseReceiptPanel: 'ErpPurchaseReceiptPanel' };
  if (name === 'ErpPurchaseReceiptPanel') {
    deps['../../hooks/usePermission'] = deps['../hooks/usePermission'];
    deps['../../production/execution/OperationalDialog'] = deps['../production/execution/OperationalDialog'];
    deps['../../lib/warehouseRecordsApi'] = {
      getWarehouseRecords: api.records,
      getErpReceiptWarehouses: async () => [{ code: 'W1', name: '量产仓' }],
      createErpReceipt: async input => { writes.push(input); throw Error('凭据刷新失败'); },
    };
  }
  if (name === 'WarehouseReturnWorkspace') {
    for (const key of ['lib/i18n', 'lib/routePaths']) deps[`../../${key}`] = deps[`../${key}`];
    deps['./warehouseViewState'] = model;
    deps['./WarehousePagination'] = { WarehousePagination: 'WarehousePagination' };
  }
  const Component = load(name, deps)[name === 'WarehouseFlowPage' ? 'WarehouseFlowWorkspace' : name === 'WarehouseWorkbench' ? 'WarehouseWorkbenchContent' : name === 'InventoryCountPage' ? 'InventoryCountContent' : name === 'ShipmentRecordsPage' ? 'ShipmentRecordsContent' : name];
  const view = {
    calls, writes, props: { issues: flows.items, reload: 0, onSaved() {} },
    render() { for (let i = 0; i < 20; i++) { dirty = false; cursor = 0; view.tree = Component(view.props); while (effects.length) effects.shift()(); if (!dirty) return view; } assert.fail('did not settle'); },
    find: predicate => all(view.tree, predicate)[0], nodes: predicate => all(view.tree, predicate),
    params: () => new URLSearchParams(params), navigate(search) { params = new URLSearchParams(search); return view.render(); },
    change(label, value) { view.find(node => node.props['aria-label'] === label).props.onChange({ target: { value } }); return view.render(); },
    click(label) { const button = view.find(node => node.type === 'Button' && text(node).trim() === label); assert.ok(button, label); button.props.onClick(); return view.render(); },
    dispose() { slots.forEach(slot => slot?.cleanup?.()); },
  }; return view;
}
const settle = () => new Promise(resolve => setImmediate(resolve));

test('ERP 入库失败按当前请求状态提示重新提交或核对原请求', async () => {
  for (const [state, requestId, readFails, retryable] of [['rejected', 'request-current', false, true], ['uncertain', 'request-current', false, false], ['rejected', 'request-other', false, false], ['rejected', 'request-current', true, false]]) {
    const view = fixture('ErpPurchaseReceiptPanel', '', { records: async () => {
      if (readFails) throw Error('状态读取失败');
      return { erpReceipts: [{ recordId: 'R1', requestId, state, quantity: 3 }] };
    } });
    Object.assign(view.props, { record: { ...record('R1'), kind: 'receipt', status: 'confirmed' }, receipts: [] });
    view.render().click('创建 ERP 采购入库单'); await settle(); view.render();
    const editor = view.find(node => node.type === 'OperationalDialog').props.editor;
    await assert.rejects(editor.submit({ warehouseCode: 'W1', date: '2026-09-29', reason: '合格入库' }, 'request-current'), retryable ? /本次未创建入库单.*关闭此表单后重新点击/ : /保持填写内容不变并再次确认/);
    assert.equal(view.writes.length, 1);
    view.dispose();
  }
});

test('仓库实际出货入口指向正式二级页，并遵循现有生产查看权限', async () => {
  for (const [permissions, visible] of [[['page:warehouse-flow'], false], [['page:production-execution'], true], [['page:warehouse-flow', 'production:ship'], false], [['*'], true]]) {
    const view = fixture('WarehouseWorkbench', '', {}, permissions).render(); await settle(); view.render();
    const link = view.find(node => node.type === 'Link' && text(node) === '实际出货记录');
    assert.equal(Boolean(link), visible);
    if (visible) assert.equal(link.props.to, '/warehouse-flow/shipments');
    view.dispose();
  }
});

test('出货页读取正式计划，保留指定计划并清理切换后的旧单据和筛选', async () => {
  const plans = [{ id: 'P1', version: 2, month: '2026-09', productName: '设备甲', productLine: 'Q7' }, { id: 'P2', version: 3, month: '2026-09', productName: '设备乙', productLine: 'Q8' }];
  const view = fixture('ShipmentRecordsPage', 'month=2026-09&plan=P2&record=S2&recordType=shipment&shipmentsSearch=旧凭证', { plans: async () => plans }, ['page:production-execution']).render(); await settle(); view.render();
  assert.equal(view.calls[0][0], '2026-09');
  assert.equal(view.find(node => node.type === 'LifecyclePanel').props.plan.id, 'P2');
  assert.equal(view.find(node => node.type === 'LifecyclePanel').props.view, 'shipments');
  view.change('生产计划', 'P1');
  assert.equal(view.find(node => node.type === 'LifecyclePanel').props.plan.id, 'P1');
  assert.equal(view.params().has('record'), false); assert.equal(view.params().has('shipmentsSearch'), false);
  view.navigate('month=2026-09&plan=missing');
  assert.equal(view.find(node => node.type === 'LifecyclePanel'), undefined);
  view.dispose();
});

test('无查看权限不读出货数据，月份切换忽略迟到响应且错误可重试', async () => {
  const denied = fixture('ShipmentRecordsPage', '', {}, ['page:warehouse-flow']).render();
  assert.equal(denied.calls.length, 0); denied.dispose();
  let resolveOld;
  const view = fixture('ShipmentRecordsPage', 'month=2026-09', { plans: month => month === '2026-09' ? new Promise(resolve => { resolveOld = resolve; }) : Promise.reject(new Error('暂时读取失败')) }).render();
  view.change('计划月份', '2026-10'); await settle(); view.render();
  resolveOld([{ id: 'old', month: '2026-09' }]); await settle(); view.render();
  assert.equal(view.find(node => node.type === 'LifecyclePanel'), undefined);
  assert.match(text(view.tree), /暂时读取失败/);
  view.click('重新加载'); await settle(); view.render();
  assert.equal(view.calls.length, 3); view.dispose();
});

test('出货默认优先本月计划并固化链接，批次原作业回到正式生产详情', async () => {
  const plans = [{ id: 'carry', month: '2026-08' }, { id: 'current', month: '2026-09' }];
  const view = fixture('ShipmentRecordsPage', 'month=2026-09', { plans: async () => plans }).render(); await settle(); view.render();
  const redirect = view.find(node => node.type === 'Navigate');
  assert.equal(new URL(redirect.props.to, 'http://local').searchParams.get('plan'), 'current');
  view.navigate('month=2026-09&plan=current&task=T1&view=tasks');
  const task = view.find(node => node.type === 'Navigate');
  assert.equal(new URL(task.props.to, 'http://local').pathname, '/production-execution');
  assert.equal(new URL(task.props.to, 'http://local').searchParams.get('task'), 'T1'); view.dispose();
});

test('发起盘点入口同时要求页面与发起权限，实盘人员只进入独立盘点页', async () => {
  for (const [permissions, canStart] of [
    [['page:warehouse-flow'], false],
    [['page:warehouse-flow', 'warehouse:count'], false],
    [['page:warehouse-flow', 'warehouse:count-initiate'], true],
    [['page:production-execution', 'warehouse:count-initiate'], false],
    [['*'], true],
  ]) {
    const view = fixture('WarehouseWorkbench', '', {}, permissions).render(); await settle(); view.render();
    const start = view.find(node => node.type === 'Link' && text(node) === '发起盘点');
    assert.equal(Boolean(start), canStart);
    if (start) assert.equal(start.props.to, '/warehouse-count?new=1');
    assert.equal(view.find(node => node.type === 'DropdownMenuItem' && text(node) === '盘点与库存处理'), undefined);
    view.dispose();
  }
});

test('独立盘点页只显示盘点，发起不填实盘，实盘与复核动作分权', async () => {
  const count = { ...record('C1'), kind: 'count', countStage: 'counting', bookQty: 200, countedQty: undefined, actorId: 'finance', actorName: '财务' };
  const data = { ...ledger, records: [count, record('R1')], balances: [{ tpInventoryCode: 'M1', warehouse: '量产仓', unit: '件', stockQty: '200', availableQty: '180', syncedAt: '2026-09-20', material: { name: '阀体' } }] };
  const create = fixture('InventoryCountPage', 'new=1', { records: async () => data }, ['page:warehouse-flow', 'warehouse:count-initiate']).render(); await settle(); create.render();
  assert.equal(create.nodes(node => node.type === 'TableRow').length, 2);
  const editor = create.find(node => node.type === 'OperationalDialog').props.editor;
  assert.equal(editor.fields.some(field => field.key === 'countedQty'), false);
  await editor.submit({ balance: '0', batch: '九月盘点', reason: '财务发起' }, 'count-create-123456');
  assert.equal(create.writes[0].action, 'start-count'); assert.equal(create.writes[0].data.code, 'M1');
  create.dispose();
  const fill = fixture('InventoryCountPage', 'record=C1', { records: async () => data }, ['page:warehouse-flow', 'warehouse:count']).render(); await settle(); fill.render();
  fill.click('填写实盘');
  await fill.find(node => node.type === 'OperationalDialog').props.editor.submit({ countedQty: 198, reason: '实际清点' }, 'count-fill-12345678');
  assert.equal(fill.writes[0].action, 'submit-count'); assert.equal(fill.writes[0].id, 'C1'); assert.equal(fill.writes[0].version, 7);
  assert.equal(fill.find(node => node.type === 'Button' && text(node) === '复核调整'), undefined); fill.dispose();
  data.records[0] = { ...count, countStage: 'review', countedQty: 198, countedBy: 'actor' };
  const self = fixture('InventoryCountPage', 'record=C1', { records: async () => data }, ['*']).render(); await settle(); self.render();
  assert.equal(self.find(node => node.type === 'Button' && text(node) === '复核调整'), undefined); self.dispose();
  data.records[0].countedBy = 'warehouse-clerk';
  const reviewer = fixture('InventoryCountPage', 'record=C1', { records: async () => data }, ['page:warehouse-count', 'warehouse:adjust']).render(); await settle(); reviewer.render();
  reviewer.click('复核调整');
  await reviewer.find(node => node.type === 'OperationalDialog').props.editor.submit({ confirmed: true, reason: '独立复核' }, 'count-review-123456');
  assert.equal(reviewer.writes[0].action, 'approve-count'); assert.equal(reviewer.writes[0].version, 7); reviewer.dispose();
  const denied = fixture('InventoryCountPage', 'new=1', {}, ['warehouse:count-initiate']).render();
  assert.equal(denied.calls.length, 0); assert.equal(denied.find(node => node.type === 'OperationalDialog'), undefined); denied.dispose();
});

test('领料列表紧凑分页，详情刷新读取全部状态，办理入口和返回上下文保留', async () => {
  const view = fixture('WarehouseFlowPage', 'issuePage=2&issueQ=作业&taskId=source-task').render(); await settle(); view.render();
  assert.equal(view.nodes(node => node.type === 'TableRow').length, 13);
  assert.equal(view.nodes(node => node.type === 'WarehouseRecordsPanel').length, 0);
  const path = view.find(node => node.type === 'Link' && text(node) === '作业 I13').props.to;
  view.navigate(path.slice(1)); await settle(); view.render();
  assert.equal(view.calls.at(-1)[1], 'all');
  assert.ok(view.find(node => node.type === 'Button' && text(node) === '登记发料'));
  assert.ok(view.find(node => node.type === 'Button' && text(node) === '确认签收'));
  view.click('登记发料'); assert.equal(view.find(node => node.type?.name === 'WarehouseIssueEditor').props.issue.id, 'I13');
  view.find(node => node.type?.name === 'WarehouseIssueEditor').props.onClose(); view.render();
  view.click('返回领料列表'); await settle(); view.render();
  assert.equal(view.params().get('issuePage'), '2'); assert.equal(view.params().get('issueQ'), '作业'); assert.equal(view.params().get('taskId'), 'source-task');
  view.change('办理状态', 'cancelled'); assert.equal(view.params().get('status'), 'all'); assert.equal(view.params().has('issuePage'), false);
  view.dispose();
});

test('台账类型/状态/凭证过滤与分页、真实详情往返均保留；列表不展示长历史', async () => {
  const data = { ...ledger, records: [...ledger.records, { ...record('count'), kind: 'count', status: 'confirmed', reconciliation: { voucher: 'ERP-1', line: '1', actorName: '复核', at: '2026-09-20', evidence: '凭证' } }] };
  const view = fixture('WarehouseRecordsPanel', 'warehouseView=records&recordPage=2&recordStatus=pending', { records: async () => data }).render(); await settle(); view.render();
  assert.equal(view.nodes(node => node.type === 'TableRow').length, 13); assert.doesNotMatch(text(view.tree), /真实退料依据/);
  const href = view.find(node => node.type === 'Link' && text(node) === '物料 R13').props.to;
  view.navigate(href.slice(1)); assert.match(text(view.tree), /真实退料依据/);
  view.click('确认退料实收');
  const editor = view.find(node => node.type === 'OperationalDialog').props.editor;
  await editor.submit({ receivedQty: 4, reason: '清点确认' }, 'request-return-123456');
  assert.deepEqual(view.writes[0], { action: 'receive-return', requestId: 'request-return-123456', id: 'R13', version: 7, data: { receivedQty: 4, reason: '清点确认' } });
  view.find(node => node.type === 'OperationalDialog').props.onClose(); view.render();
  view.click('返回仓库台账'); assert.equal(view.params().get('recordPage'), '2'); assert.equal(view.params().get('recordStatus'), 'pending');
  view.change('仓库台账状态', 'all'); view.change('仓库台账核对状态', 'checked');
  assert.equal(view.find(node => node.type === 'WarehousePagination').props.total, 1);
  view.change('仓库台账类型', 'count');
  assert.equal(view.find(node => node.type === 'Navigate').props.to, '/warehouse-count');
  view.navigate('warehouseView=records&record=count');
  assert.equal(view.find(node => node.type === 'Navigate').props.to, '/warehouse-count?record=count');
  view.navigate('warehouseView=records&record=missing'); assert.match(text(view.tree), /不在当前可见范围/);
  view.dispose();
});

test('只读人员保留事实，不能出现仓管/复核动作；旧来源响应不会覆盖新范围', async () => {
  const read = fixture('WarehouseRecordsPanel', 'warehouseView=records&record=R1', {}, []).render(); await settle(); read.render();
  for (const label of ['确认退料实收', '复核盘点', '核对 ERP 凭证', '撤销']) assert.equal(read.find(node => node.type === 'Button' && text(node) === label), undefined);
  read.dispose();
  let resolveOld; const old = new Promise(resolve => { resolveOld = resolve; });
  const view = fixture('WarehouseFlowPage', 'taskId=old', { flows: async task => task === 'old' ? old : { ...flows, items: [{ ...issue('new'), title: '新来源作业' }] } }).render();
  view.navigate('taskId=new'); await settle(); view.render(); resolveOld(flows); await settle(); view.render();
  assert.match(text(view.tree), /新来源作业/); assert.doesNotMatch(text(view.tree), /作业 I1/); assert.equal(view.calls[0][2].aborted, true);
  view.dispose();
});

test('分页无遗漏；人工核对不宣称ERP已同步，差异优先提示', () => {
  assert.equal(new Set([1, 2, 3].flatMap(page => model.warehousePage(ledger.records, String(page)).rows.map(row => row.id))).size, 25);
  const row = issue('check'); row.history.push({ id: 'check', action: 'reconcile', reconciliation: { eventId: 'event', result: 'matched' } });
  assert.equal(model.warehouseCheckLabel(row), '人工核对一致');
  row.history.push({ id: 'difference', action: 'reconcile', reconciliation: { eventId: 'event', result: 'difference' } });
  assert.equal(model.warehouseCheckLabel(row), '存在差异，待处理');
});

test('仓库驾驶舱不因页面权限扩大数据访问，分批发料可同时待发与待签', () => {
  assert.deepEqual(cockpitModel.warehouseCockpitAccess(['page:warehouse-cockpit']), { inventory: false, receipts: false, flows: false, allFlows: false, counts: false, startCount: false });
  assert.equal(cockpitModel.warehouseCockpitAccess(['page:purchase-order-detail']).receipts, false);
  assert.equal(cockpitModel.warehouseCockpitAccess(['page:purchase-order-detail', 'proc-purchase-order:receive']).receipts, true);
  assert.equal(cockpitModel.warehouseCockpitAccess(['page:production-execution']).allFlows, false);
  assert.deepEqual(cockpitModel.warehouseCockpitAccess(['*']), { inventory: true, receipts: true, flows: true, allFlows: true, counts: true, startCount: true });
  const rows = [issue('partial'), { ...issue('cancelled'), status: 'cancelled' }, { ...issue('signed'), status: 'signed' }, { ...issue('new'), lines: [{ quantity: 5 }] }, { ...issue('ready'), lines: [{ quantity: 5, issuedQty: 5, signedQty: 2 }] }];
  const result = cockpitModel.warehouseIssueSummary(rows);
  assert.deepEqual(result.pending.map(row => row.id), ['partial', 'new']);
  assert.deepEqual(result.signing.map(row => row.id), ['partial', 'ready']);
});

test('仓库驾驶舱加载独立失败、切换查询与卸载均取消旧响应，没有权限不读取接口', async () => {
  let cursor = 0; const slots = [], effects = [];
  const hooks = {
    useState(initial) { const i = cursor++; if (!(i in slots)) slots[i] = initial; return [slots[i], value => { slots[i] = value; }]; },
    useEffect(effect, deps) { const i = cursor++, old = slots[i]; if (!old || deps.some((value, j) => value !== old.deps[j])) { slots[i] = { deps, cleanup: old?.cleanup }; effects.push(() => { slots[i].cleanup?.(); slots[i].cleanup = effect(); }); } },
  };
  const { useWarehouseResource } = evaluate(cockpitSource, { react: hooks, '../../lib/permissions': cockpitPermissions });
  const render = (key, loader) => { cursor = 0; const view = useWarehouseResource(key, loader); while (effects.length) effects.shift()(); return view; };
  let resolveOld, oldSignal, calls = 0;
  const old = signal => { calls++; oldSignal = signal; return new Promise(resolve => { resolveOld = resolve; }); };
  assert.equal(render(null, old).loading, false); assert.equal(calls, 0);
  assert.equal(render('old', old).loading, true);
  const failure = async () => { throw new Error('库存接口不可用'); };
  render('new', failure); await settle(); assert.equal(oldSignal.aborted, true);
  assert.equal(render('new', failure).error, '库存接口不可用');
  resolveOld({ count: 100 }); await settle(); assert.equal(render('new', failure).data, null);
  const retry = async () => ({ count: 3 }); render('retry', retry); await settle();
  assert.deepEqual(render('retry', retry).data, { count: 3 });
  assert.equal(render(null, retry).data, null);
  render('unmount', old); slots[1].cleanup(); resolveOld({ count: 999 }); await settle();
  assert.equal(render('unmount', old).data, null);
});

test('仓库侧栏只有工作台入口，保留旧驾驶舱兼容路由与权限', () => {
  const code = 'page:warehouse-flow';
  for (const path of ['/warehouse-flow', '/storage/workbench']) {
    const routes = evaluate(readCockpit('src/app/routesConfig.tsx'), { 'lucide-react': primitives, './lib/routePaths': { routePath: (key, fallback) => key === code ? path : fallback, subRoutePath: (_, base, suffix) => `${base}/${suffix}` } });
    const entry = routes.navGroups.find(group => group.label === '订单与仓储').items.find(item => item.requiredPermission === code);
    assert.equal(routes.navGroups.flatMap(group => group.items).some(item => item.requiredPermission === 'page:warehouse-cockpit'), false);
    assert.equal(entry.path, path); assert.equal(entry.label, '仓库工作台');
    assert.equal(routes.routeTitleMap[path], '仓库工作台'); assert.equal(routes.routePermissionMap[path], code);
    assert.equal(routes.routeTitleMap['/warehouse-count'], '库存盘点');
  }
  const catalog = evaluate(readCockpit('apps/api/src/modules/permission-catalog/permission-catalog.defaults.ts'), {}).DEFAULT_PERMISSION_CATALOG;
  assert.equal(catalog.find(item => item.code === code).routePath, '/warehouse-flow');
  const app = readCockpit('src/app/App.tsx');
  assert.match(app, /makeLazyProtected\(<WarehouseCockpit \/>, "page:warehouse-cockpit"\)/);
  assert.match(app, /location.pathname === routePath\("page:warehouse-cockpit", "\/warehouse-cockpit"\)/);
});

test('驾驶舱入库单限定收货记录，不能被旧筛选或跨类型详情串到退料', async () => {
  const receipt = { ...record('receipt-1'), kind: 'receipt', status: 'confirmed' };
  const view = fixture('WarehouseRecordsPanel', 'recordKind=return', { records: async () => ({ ...ledger, records: [receipt, record('return-1')] }) });
  view.props.scope = { kind: 'receipt' };
  view.render(); await settle(); view.render();
  assert.equal(view.find(node => node.type === 'WarehousePagination').props.total, 1);
  assert.match(text(view.tree), /入库单/);
  assert.equal(view.find(node => node.props['aria-label'] === '仓库台账类型'), undefined);
  for (const label of ['发起退料', '登记盘点', '冻结库存']) assert.equal(view.find(node => node.type === 'Button' && text(node) === label), undefined);
  view.navigate('record=return-1'); assert.match(text(view.tree), /不在当前可见范围/);
  view.dispose();
});

test('配料区退料只关联所选派工，返回明细保持派工上下文', async () => {
  const view = fixture('WarehouseRecordsPanel', 'cockpitTab=picking&dispatch=I1', { records: async () => ({ ...ledger, records: [{ ...record('own'), taskId: 'I1' }, { ...record('other'), taskId: 'I2' }] }) });
  view.props.scope = { kind: 'return', taskId: 'I1' };
  view.render(); await settle(); view.render();
  assert.equal(view.find(node => node.type === 'WarehousePagination').props.total, 1);
  assert.match(text(view.tree), /物料 own/); assert.doesNotMatch(text(view.tree), /物料 other/);
  view.click('发起退料');
  const editor = view.find(node => node.type === 'OperationalDialog').props.editor;
  assert.equal(editor.fields.find(field => field.key === 'source').options.length, 1);
  assert.deepEqual(JSON.parse(editor.fields.find(field => field.key === 'source').options[0].value), ['I1', 'M1']);
  view.navigate('cockpitTab=picking&dispatch=I1&record=own'); view.click('返回生产退料');
  assert.equal(view.params().get('dispatch'), 'I1'); assert.equal(view.params().get('cockpitTab'), 'picking');
  view.dispose();
});


test('仓库工作台四个业务标签，配料关联退料跳转保留派工，入库与退料单独办理', async () => {
  const view = fixture('WarehouseWorkbench', '').render(); await settle(); view.render();
  assert.deepEqual(view.nodes(node => node.type === 'TabsTrigger').map(node => node.props.value), ['picking', 'issues', 'receipts', 'returns']);
  assert.ok(view.calls.some(args => args[1] === 'all'));
  assert.equal(view.find(node => node.type === 'WarehouseRecordsPanel'), undefined);
  const row = view.find(node => node.type === 'Button' && text(node).includes('作业 I2 '));
  row.props.onClick(); view.render();
  view.click('关联生产退料');
  assert.equal(view.params().get('workbenchTab'), 'picking');
  assert.equal(view.find(node => node.type === 'WarehouseRecordsPanel').props.scope.taskId, 'I2');
  assert.equal(view.find(node => node.type === 'WarehouseRecordsPanel').props.returnWorkspace, true);
  view.click('登记发料');
  assert.equal(view.find(node => node.type === 'WarehouseIssueEditor').props.issue.id, 'I2');
  view.find(node => node.type === 'WarehouseIssueEditor').props.onClose(); view.render();
  view.find(node => node.type === 'Tabs').props.onValueChange('receipts'); view.render();
  assert.deepEqual(view.find(node => node.type === 'WarehouseRecordsPanel').props.scope, { kind: 'receipt' });
  view.navigate('workbenchTab=returns&returnTask=I2');
  assert.deepEqual(view.find(node => node.type === 'WarehouseRecordsPanel').props.scope, { kind: 'return', taskId: 'I2' });
  assert.equal(view.find(node => node.type === 'WarehouseRecordsPanel').props.returnWorkspace, true);
  assert.doesNotMatch(text(view.tree), /库存动态|历史月份|库存记录|计划派工/);
  view.dispose();
});

test('顶部待办页内筛选、逾期去重；清除筛选恢复全部，权限不扩大', async () => {
  const overdue = { ...issue('late'), neededDate: '2020-01-01' };
  const view = fixture('WarehouseWorkbench', '', { flows: async () => ({ ...flows, items: [overdue] }) }).render();
  await settle(); view.render();
  const metric = view.find(node => node.props['aria-label'] === '逾期提醒');
  assert.match(text(metric), /已过需求日.*1/);
  metric.props.onClick(); view.render();
  assert.equal(view.params().get('overdue'), '1');
  assert.equal(view.params().get('workbenchTab'), 'issues');
  view.click('清除筛选');
  assert.equal(view.params().has('overdue'), false);
  view.find(node => node.props['aria-label'] === '待签收').props.onClick(); view.render();
  assert.equal(view.params().get('dispatchView'), 'signing');
  view.find(node => node.props['aria-label'] === '待接收退料').props.onClick(); view.render();
  assert.equal(view.params().get('workbenchTab'), 'returns');
  assert.equal(view.params().has('dispatchView'), false);
  view.dispose();
  const denied = fixture('WarehouseWorkbench', '', {}, ['page:warehouse-cockpit']).render();
  assert.equal(denied.calls.length, 0); denied.dispose();
});

test('旧驾驶舱书签自动进入工作台并保留定位参数', () => {
  const view = fixture('WarehouseCockpit', 'cockpitTab=returns&record=R1').render();
  const redirect = view.find(node => node.type === 'Navigate');
  assert.equal(redirect.props.replace, true);
  const query = new URL(redirect.props.to, 'http://local').searchParams;
  assert.equal(query.get('workbenchTab'), 'returns'); assert.equal(query.get('record'), 'R1');
  assert.equal(query.has('cockpitTab'), false);
  view.dispose();
});

test('旧原单和台账链接仍在统一框架内，更多操作不再打开旧页面', async () => {
  const view = fixture('WarehouseWorkbench', 'issue=I2').render(); await settle(); view.render();
  assert.equal(view.find(node => node.type === 'OrderPageHeader').props.title, '仓库工作台');
  assert.equal(view.find(node => node.type === 'Tabs').props.value, 'issues');
  assert.match(text(view.tree), /作业 I2/);
  view.click('原单记录与凭证'); view.click('核对凭证');
  assert.equal(view.find(node => node.type === 'WarehouseReconcileEditor').props.issue.id, 'I2');
  view.find(node => node.type === 'WarehouseReconcileEditor').props.onClose(); view.render();
  view.find(node => node.type === 'DropdownMenuItem' && text(node) === '冻结与报废').props.onSelect(); view.render();
  assert.equal(view.find(node => node.type === 'WarehouseRecordsPanel').props.mode, 'other');
  assert.equal(view.find(node => node.type === 'OrderPageHeader').props.title, '仓库工作台');
  view.navigate('warehouseView=records&record=R1');
  assert.ok(view.find(node => node.type === 'WarehouseRecordsPanel'));
  view.dispose();
});

test('更多操作只处理冻结报废，盘点独立，凭证视图不提供新建入口', async () => {
  const data = { ...ledger, records: [record('return'), { ...record('count'), kind: 'count', status: 'confirmed' }, { ...record('freeze'), kind: 'freeze', status: 'confirmed' }] };
  const view = fixture('WarehouseRecordsPanel', '', { records: async () => data }); view.props.mode = 'other';
  view.render(); await settle(); view.render();
  assert.equal(view.find(node => node.type === 'WarehousePagination').props.total, 1);
  assert.equal(view.find(node => node.type === 'Button' && text(node) === '发起退料'), undefined);
  view.props.mode = 'reconcile'; view.render();
  for (const label of ['发起退料', '收货入库', '登记盘点', '冻结库存']) assert.equal(view.find(node => node.type === 'Button' && text(node) === label), undefined);
  view.dispose();
});

test('工作台逾期队列仅包含未完成单，普通查看权限不会出现仓管动作', async () => {
  const view = fixture('WarehouseWorkbench', 'workbenchTab=issues&overdue=1&dispatchView=unfinished', { flows: async () => ({ ...flows, canIssue: false, items: [
    { ...issue('read'), neededDate: '2020-01-01', recipientId: 'other' },
    { ...issue('done'), status: 'signed', neededDate: '2020-01-01' },
  ] }) }, ['page:warehouse-flow']).render();
  await settle(); view.render();
  for (const label of ['登记发料', '确认签收']) assert.equal(view.find(node => node.type === 'Button' && text(node) === label), undefined);
  assert.equal(view.find(node => node.type === 'WarehousePagination').props.total, 1);
  view.dispose();
});

test('退料左右分栏默认待处理，类型日期搜索与来源限定有效，旧记录链接不丢失', () => {
  const view = fixture('WarehouseReturnWorkspace', '');
  view.props = { records: [
    { ...record('R1'), taskId: 'I1' },
    { ...record('R2'), taskId: 'I2', status: 'confirmed', defectiveQty: 0, pendingQty: 0 },
    { ...record('R3'), taskId: 'I1', review: { open: true, actualQty: 3, reason: '数量差异', actorName: '仓管', at: '2026-09-21' } },
  ], issues: flows.items, actions: () => null };
  view.render(); assert.equal(view.find(node => node.type === 'WarehousePagination').props.total, 2);
  view.change('退料状态', 'review'); assert.equal(view.find(node => node.type === 'WarehousePagination').props.total, 1);
  assert.match(text(view.tree), /数量差异/);
  view.change('退料状态', 'all'); view.change('搜索退料单', 'R2');
  assert.equal(view.find(node => node.type === 'WarehousePagination').props.total, 1);
  view.props.taskId = 'I1'; view.render(); assert.equal(view.find(node => node.type === 'WarehousePagination').props.total, 0);
  view.navigate('record=R2'); assert.match(text(view.tree), /退料单不在当前范围/);
  view.navigate('record=R1'); assert.match(text(view.tree), /原单信息/);
  assert.doesNotMatch(text(view.tree), /库存变化|上传照片/);
  view.dispose();
});

test('退料工作台复用安全操作表单，接收写入库位，待核对单禁止接收', async () => {
  const view = fixture('WarehouseRecordsPanel', 'workbenchTab=returns&record=R1').render(); await settle();
  view.props.returnWorkspace = true; view.props.scope = { kind: 'return' }; view.render();
  const component = view.find(node => node.type === 'WarehouseReturnWorkspace');
  let actionTree = component.props.actions(record('R1'));
  const receive = all(actionTree, node => node.type === 'Button' && text(node) === '核对接收并隔离')[0];
  receive.props.onClick(); view.render();
  const editor = view.find(node => node.type === 'OperationalDialog').props.editor;
  assert.ok(editor.fields.find(field => field.key === 'receivingLocation'));
  assert.ok(editor.fields.find(field => field.key === 'warehouse'));
  await editor.submit({ receivedQty: 5, warehouse: '隔离仓', receivingLocation: 'A-01', reason: '核对一致' }, 'return-workspace-test');
  assert.equal(view.writes[0].data.receivingLocation, 'A-01');
  actionTree = component.props.actions({ ...record('R1'), review: { open: true } });
  assert.equal(all(actionTree, node => node.type === 'Button' && text(node).includes('核对接收')).length, 0);
  view.dispose();
});
