import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

function compile(file, result, bindings = {}) {
  const source = readFileSync(new URL(file, import.meta.url), 'utf8');
  const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const body = ast.statements.filter(node => !ts.isImportDeclaration(node)).map(node => node.getText(ast)).join('\n');
  const code = ts.transpileModule(body, { compilerOptions: { jsx: ts.JsxEmit.React, target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  return new Function(...Object.keys(bindings), `const exports = {};\n${code}\nreturn ${result};`)(...Object.values(bindings));
}
const lifecycleRecordParams = compile('./LifecycleViews.tsx', 'lifecycleRecordParams');
const elements = tree => Array.isArray(tree) ? tree.flatMap(elements) : tree && typeof tree === 'object' ? [tree, ...Object.values(tree.props ?? {}).flatMap(elements)] : [];
const find = (tree, predicate) => elements(tree).find(predicate);
const flush = () => new Promise(resolve => setImmediate(resolve));

const batch = { id: 'b1', code: 'Q7-01', quantity: 100, dueDate: '2026-09-30', completedQty: 80, openQuality: 0, uninspected: false, releasedQty: 60, releaseId: 'r1', shippedQty: 20, tasks: [{ id: 'task1', batchId: 'b1', name: '整机装配', ownerName: '现场甲', ownerId: 'worker', status: 'dispatched', quantity: 100, unit: '台', line: '一线', reports: [], inspections: [] }] };
const plan = { id: 'plan1', version: 2, month: '2026-09', productName: '制氧机', productLine: 'Q7', batches: [batch], tasks: batch.tasks, shipmentTargetQty: 100 };
const transfer = { id: 't1', code: 'TP-V1', type: 'validation', status: 'draft', authorId: 'author', sampleTaskId: 'sample1', roundId: 'round1', sop: 'SOP-V1', sip: 'SIP-V1', drawing: 'BOM-V1', evidence: '样品确认' };
const shipment = { id: 's1', batchId: 'b1', releaseId: 'r1', voucher: 'FH-1', quantity: 20, date: '2026-09-18', order: 'SO-1', recipient: '客户甲', evidence: '凭证依据', actorName: '发货甲' };
const lifecycle = { version: 4, transfers: [transfer], changes: [], releases: [{ id: 'r1', batchId: 'b1', quantity: 60, actorName: '质量甲', at: '2026-09-17T00:00:00Z', evidence: '合格' }], shipments: [shipment], batches: [batch], sampleTasks: [], warehouse: [], qualityRecords: [], verificationHistory: [], events: [] };

function fixture({ query = 'view=transfer&record=t1&recordType=transfer', userId = 'verifier', permissions = [], data = lifecycle, read } = {}) {
  let slot = 0, mounted = false, params = new URLSearchParams(`month=2026-09&plan=plan1&${query}`);
  const slots = [], effects = [], cleanups = [], writes = [];
  const bindings = {
    React: { createElement: (type, props, ...children) => ({ type, props: { ...props, children: children.length === 1 ? children[0] : children } }) },
    useAuth: () => ({ user: { id: userId, roleId: 'role1', permissions } }),
    usePermission: permission => permissions.includes(permission),
    useSearchParams: () => [params, change => { params = typeof change === 'function' ? change(params) : change; }],
    useState(initial) { const i = slot++; if (!(i in slots)) slots[i] = i === 0 ? data : initial; return [slots[i], value => { slots[i] = typeof value === 'function' ? value(slots[i]) : value; }]; },
    useEffect(effect) { if (!mounted && read) effects.push(effect); },
    getLifecycle: read,
    commandProductionLifecycle: async (id, path, command) => { writes.push({ id, path, command }); return { saved: true }; },
    lifecycleRecordParams, lifecycleDate: value => value,
  };
  for (const name of ['Button', 'Tabs', 'TabsContent', 'TabsList', 'TabsTrigger', 'OperationalDialog', 'ProductionEmpty', 'ProductionMetrics', 'ProductionStatus', 'LifecycleDetailHeader', 'LifecycleFields', 'LifecycleLink', 'LifecycleTable', 'LifecycleControlledDocuments', 'LifecycleVersionRanges', 'LifecycleShipmentSerials', 'ShipmentSerialDialog']) bindings[name] = name;
  const Component = compile('./LifecyclePanel.tsx', 'LifecycleWorkspace', bindings);
  function render() { slot = 0; const tree = Component({ plan, view: params.get('view') || 'transfer' }); if (!mounted) { mounted = true; for (const effect of effects) { const cleanup = effect(); if (cleanup) cleanups.push(cleanup); } } return tree; }
  return { render, writes, params: () => params, destroy: () => cleanups.forEach(cleanup => cleanup()) };
}
const button = (f, label) => find(f.render(), row => row.type === 'Button' && row.props.children === label);

test('详情打开和返回仅修改 record 参数，保留原计划月份与独立筛选', () => {
  const original = new URLSearchParams('month=2026-09&plan=p1&view=archive&archivesSearch=第二批&archivesPage=2');
  const detail = lifecycleRecordParams(original, { type: 'batch', id: 'b1' });
  assert.equal(original.has('record'), false);
  assert.equal(detail.get('recordType'), 'batch');
  assert.equal(detail.get('record'), 'b1');
  assert.equal(lifecycleRecordParams(detail).toString(), original.toString());
});

test('资料独立验证保留权限与编制人隔离，提交原资料及版本', async () => {
  const f = fixture({ permissions: ['production:release'] });
  button(f, '登记独立验证').props.onClick();
  const dialog = find(f.render(), row => row.type === 'OperationalDialog');
  await dialog.props.editor.submit({ documentsChecked: true, productionValidated: true, reason: '验证通过' }, 'request1');
  assert.deepEqual(f.writes[0], { id: 'plan1', path: 'lifecycle', command: { action: 'validate-transfer', requestId: 'request1', version: 4, data: { documentsChecked: true, productionValidated: true, reason: '验证通过', id: 't1' } } });
  assert.equal(button(fixture({ userId: 'author', permissions: ['production:release'] }), '登记独立验证'), undefined);
  assert.equal(button(fixture(), '登记独立验证'), undefined);
});

test('批次档案进入原作业保留筛选并清除冲突详情参数', () => {
  const f = fixture({ query: 'view=archive&record=b1&recordType=batch&inspection=old&taskSection=old&archivesSearch=Q7&archivesPage=2' });
  const table = find(f.render(), row => row.type === 'LifecycleTable' && row.props.title === '批次作业');
  const link = find(table.props.columns[0].cell(batch.tasks[0]), row => row.type === 'LifecycleLink');
  link.props.onClick();
  assert.equal(f.params().get('task'), 'task1');
  assert.equal(f.params().get('view'), 'tasks');
  assert.equal(f.params().get('plan'), 'plan1');
  assert.equal(f.params().get('month'), '2026-09');
  assert.equal(f.params().get('archivesSearch'), 'Q7');
  assert.equal(f.params().get('archivesPage'), '2');
  for (const key of ['record', 'recordType', 'inspection', 'taskSection']) assert.equal(f.params().has(key), false);
});

test('发货冲销详情保留原凭证；冲销后不能再次冲销', async () => {
  const query = 'view=shipments&record=s1&recordType=shipment';
  const f = fixture({ query, permissions: ['production:ship'] });
  button(f, '凭证冲销').props.onClick();
  await find(f.render(), row => row.type === 'OperationalDialog').props.editor.submit({ evidenceChecked: true, reason: '原货退回' }, 'reverse1');
  assert.equal(f.writes[0].command.action, 'reverse-shipment');
  assert.equal(f.writes[0].command.data.id, 's1');
  const reversed = fixture({ query, permissions: ['production:ship'], data: { ...lifecycle, shipments: [{ ...shipment, reversed: { actorName: '发货乙', at: '2026-09-19', reason: '原货退回' } }] } });
  assert.equal(button(reversed, '凭证冲销'), undefined);
  const fields = find(reversed.render(), row => row.type === 'LifecycleFields');
  assert.ok(fields.props.items.some(item => item.label === '冲销记录' && item.value.includes('原货退回')));
});

test('失效详情不显示其他记录，返回后仍在原列表范围', () => {
  const f = fixture({ query: 'view=archive&record=missing&recordType=batch&archivesPage=2' });
  assert.equal(find(f.render(), row => row.type === 'ProductionEmpty').props.title, '记录不存在或当前无权查看');
  assert.equal(find(f.render(), row => row.type === 'LifecycleFields'), undefined);
  button(f, '返回列表').props.onClick();
  assert.equal(f.params().get('view'), 'archive');
  assert.equal(f.params().get('archivesPage'), '2');
});

test('读取失败可重试，卸载取消读取后迟到数据不进入旧工作区', async () => {
  const failed = fixture({ data: null, read: async () => { throw new Error('当前无权读取'); } });
  failed.render(); await flush();
  assert.ok(find(failed.render(), row => row.props?.role === 'alert'));
  assert.ok(button(failed, '重新加载'));
  let resolve, signal;
  const pending = fixture({ data: null, read: (_id, nextSignal) => { signal = nextSignal; return new Promise(done => { resolve = done; }); } });
  pending.render(); pending.destroy(); assert.equal(signal.aborted, true);
  resolve(lifecycle); await flush();
  assert.ok(find(pending.render(), row => row.props?.role === 'status'));
  assert.equal(find(pending.render(), row => row.type === 'LifecycleFields'), undefined);
});

test('新转产选择已交付固定文件版本；缺三项依据不提交，提交保留原样品轮次', async () => {
  const sample = { id: 'sample1', code: 'SP1', title: '样品', roundId: 'round1', documents: ['sop', 'sip', 'drawing'].map(kind => ({ versionId: `${kind}-v1`, name: `${kind}.pdf`, version: 'V1' })) };
  const f = fixture({ query: 'view=transfer', permissions: ['production:transfer'], data: { ...lifecycle, sampleTasks: [sample] } });
  button(f, '新增资料版本').props.onClick();
  const editor = find(f.render(), row => row.type === 'OperationalDialog').props.editor;
  const input = { code: 'TP-V2', type: 'validation', sample: JSON.stringify(['sample1', 'round1']), reason: '本轮已验证' };
  await assert.rejects(editor.submit(input, 'req1'), /固定版本/); assert.equal(f.writes.length, 0);
  await editor.submit({ ...input, sopVersion: 'sop-v1', sipVersion: 'sip-v1', drawingVersion: 'drawing-v1' }, 'req2');
  assert.equal(f.writes[0].command.data.sampleTaskId, 'sample1'); assert.equal(f.writes[0].command.data.roundId, 'round1');
  assert.deepEqual(f.writes[0].command.data.documents, [{ kind: 'sop', versionId: 'sop-v1' }, { kind: 'sip', versionId: 'sip-v1' }, { kind: 'drawing', versionId: 'drawing-v1' }]);
});

test('ECN反馈提交原编号，当前经办可处理且保留期限；无关人员无处理按钮', async () => {
  const entry = { id: 'feedback1', reporterId: 'worker', reporterName: '现场', problem: '无法执行', ownerId: 'verifier', ownerName: '经办', dueDate: '2026-10-01', status: 'open', at: '2026-09-20', history: [] };
  const change = { id: 'ecn1', code: 'ECN01', packageId: 't1', batchIds: ['b1'], effectiveDate: '2026-09-20', status: 'published', handling: '隔离旧料', acknowledgments: [], feedback: [entry] };
  const data = { ...lifecycle, changes: [change], handlers: [{ id: 'verifier', name: '经办' }] };
  const f = fixture({ query: 'view=transfer&record=ecn1&recordType=ecn', data });
  const table = find(f.render(), row => row.type === 'LifecycleTable' && row.props.title === '执行问题反馈');
  const action = table.props.columns.at(-1).cell(entry); action.props.onClick();
  const editor = find(f.render(), row => row.type === 'OperationalDialog').props.editor;
  assert.equal(editor.fields.find(field => field.key === 'dueDate').value, '2026-10-01');
  await editor.submit({ ownerId: 'verifier', dueDate: '2026-10-02', status: 'resolved', reason: '复核后可执行' }, 'handle1');
  assert.equal(f.writes[0].command.data.id, 'ecn1'); assert.equal(f.writes[0].command.data.feedbackId, 'feedback1');
  const other = fixture({ query: 'view=transfer&record=ecn1&recordType=ecn', userId: 'other', data });
  const otherTable = find(other.render(), row => row.type === 'LifecycleTable' && row.props.title === '执行问题反馈');
  assert.equal(otherTable.props.columns.at(-1).cell(entry), '—');
});

test('批次版本更正只传原范围ID，空SN保持空；档案检索覆盖已有SN', async () => {
  const range = { id: 'range1', batchId: 'b1', quantity: 20, range: '首段', softwareVersion: 'S1', hardwareVersion: '', serialNumbers: ['SN-EXISTING'], actorName: '登记人' };
  const data = { ...lifecycle, versionRanges: [range] };
  const f = fixture({ query: 'view=archive&record=b1&recordType=batch', permissions: ['production:transfer'], data });
  const ranges = find(f.render(), row => row.type === 'LifecycleVersionRanges');
  ranges.props.onEdit(range);
  const editor = find(f.render(), row => row.type === 'OperationalDialog').props.editor;
  await editor.submit({ quantity: 20, range: '首段更正', softwareVersion: '', hardwareVersion: '', serialNumbers: '', reason: '版本待核' }, 'range1');
  assert.deepEqual(f.writes[0].command.data.serialNumbers, []); assert.equal(f.writes[0].command.data.supersedesId, range.id); assert.equal(f.writes[0].command.data.batchId, 'b1');
  const list = fixture({ query: 'view=archive', data });
  assert.match(find(list.render(), row => row.type === 'LifecycleTable' && row.props.title === '批次追溯档案').props.searchText(batch), /SN-EXISTING/);
});

test('实发SN补录沿原发货单提交，权限/冲销限制保留，发货目录支持SN查询', async () => {
  const query = 'view=shipments&record=s1&recordType=shipment';
  const f = fixture({ query, permissions: ['production:ship'] });
  button(f, '补录实发 SN').props.onClick();
  const picker = find(f.render(), row => row.type === 'ShipmentSerialDialog');
  assert.equal(picker.props.shipment.id, 's1');
  await picker.props.submit(['SN-A'], '实发清单核对', 'serial-request');
  assert.deepEqual(f.writes[0].command, { action: 'bind-shipment-sns', requestId: 'serial-request', version: 4, data: { id: 's1', serialNumbers: ['SN-A'], reason: '实发清单核对' } });
  assert.equal(button(fixture({ query }), '补录实发 SN'), undefined);
  const reversed = { ...shipment, serials: [{ number: 'SN-A', softwareVersion: 'S1', hardwareVersion: 'H1' }], reversed: { actorName: '发货员', at: '2026-09-20', reason: '实物退回' } };
  assert.equal(button(fixture({ query, permissions: ['production:ship'], data: { ...lifecycle, shipments: [reversed] } }), '补录实发 SN'), undefined);
  const list = fixture({ query: 'view=shipments', data: { ...lifecycle, shipments: [reversed] } });
  assert.match(find(list.render(), row => row.type === 'LifecycleTable' && row.props.title === '发货记录').props.searchText(reversed), /SN-A/);
});

test('登记实际发货只提交填写的SN子集，未填写不把批次SN自动算作已发', async () => {
  const f = fixture({ query: 'view=shipments&record=b1&recordType=batch', permissions: ['production:ship'] });
  button(f, '实际发货').props.onClick();
  const editor = find(f.render(), row => row.type === 'OperationalDialog').props.editor;
  assert.ok(editor.fields.some(field => field.key === 'serialNumbers' && field.optional));
  await editor.submit({ quantity: 20, serialNumbers: 'SN-A\n SN-B \n', reason: '实发' }, 'new-ship');
  assert.deepEqual(f.writes[0].command.data.serialNumbers, ['SN-A', 'SN-B']);
  await editor.submit({ quantity: 20, reason: 'SN待采集' }, 'new-no-sn');
  assert.deepEqual(f.writes[1].command.data.serialNumbers, []);
});
