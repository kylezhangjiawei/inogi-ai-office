import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

const node = (type, props) => ({ type, props: props || {} });
const nodes = tree => Array.isArray(tree) ? tree.flatMap(nodes) : tree && typeof tree === 'object' && tree.props ? [tree, ...nodes(tree.props.children)] : [];
const text = tree => Array.isArray(tree) ? tree.map(text).join('') : tree && typeof tree === 'object' && tree.props ? text(tree.props.children) : tree == null ? '' : String(tree);
const flush = () => new Promise(resolve => setImmediate(resolve));
const names = { unknown: '未知 / 待分析', process: '工艺', packaging: '包装', standard: '检验标准', revision: '版本', material: '物料', other: '其他' };
function fixture(name, props, mocks = {}) {
  const slots = [], effects = [];
  let cursor = 0, initialized = false;
  const controls = new Proxy({}, { get: (_, key) => String(key) });
  const defaults = {
    'react/jsx-runtime': { jsx: node, jsxs: node, Fragment: 'Fragment' },
    react: {
      useState(initial) { const index = cursor++; if (!(index in slots)) slots[index] = typeof initial === 'function' ? initial() : initial; return [slots[index], value => slots[index] = typeof value === 'function' ? value(slots[index]) : value]; },
      useRef(initial) { return slots[cursor++] ??= { current: initial }; },
      useEffect(callback) { if (!initialized) effects.push(callback); },
    },
    'react-router': { useSearchParams: () => [new URLSearchParams(), () => {}] },
    '../../auth': { useAuth: () => ({ user: { id: 'worker', permissions: [] } }) },
    '../../hooks/usePermission': { usePermission: () => false },
    './QualityAnalysisDialog': { QualityAnalysisDialog: 'QualityAnalysisDialog', qualityCauseNames: names, qualitySourceNames: { procurement: '采购', production: '生产', warehouse: '仓库', after_sales: '售后' } },
  };
  const filename = name === 'QualityAnalysisContent' ? 'QualityAnalysisDialog' : name;
  const source = readFileSync(new URL(`../src/app/procurement/quality/${filename}.tsx`, import.meta.url), 'utf8') + (name === 'QualityAnalysisContent' ? '\nexport { QualityAnalysisContent };' : '');
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const exports = {};
  new Function('require', 'exports', code)(key => mocks[key] || defaults[key] || controls, exports);
  return { exports, render() { cursor = 0; const tree = exports[name](props); if (!initialized) { initialized = true; effects.forEach(effect => effect()); } return tree; } };
}
const analysis = { version: 1, state: 'pending', category: 'unknown', detail: '', evidence: '现场照片', responsibility: { kind: 'unknown', name: '' }, phenomena: [{ name: '划痕', count: 6 }, { name: '偏位', count: 2 }], files: [], references: [], history: [] };
const record = { id: 'q1', source: 'procurement', batchNo: 'B1', treeNodeName: '装配', materialId: 'm1', materialName: '同名物料', supplierId: 's1', supplierName: '供应商甲', issue: '划痕', unit: '件', inspectedQty: 100, defectiveQty: 6, status: 'open', disposition: 'pending', updatedAt: '2026-09-20T00:00:00Z', inspectionDate: '2026-09-20', analysis };
const response = row => ({ record: row, analysis: row.analysis, people: [], suppliers: [], productionSource: null, receivedBatches: [] });
const button = (f, label) => nodes(f.render()).find(row => row.type === 'Button' && text(row) === label);
const control = (f, label) => nodes(f.render()).find(row => row.props['aria-label'] === label);

test('主因仅按去重原异常的不良数量汇总，待确认主因回归未知，单位分离', () => {
  const f = fixture('QualityRecordsPanel', { records: [], onSaved() {} });
  const confirmed = { ...record, id: 'q2', analysis: { ...analysis, state: 'confirmed', category: 'process' } };
  const pending = { ...record, id: 'q3', unit: '台', inspectedQty: 10, defectiveQty: 2, analysis: { ...analysis, category: 'process' } };
  const summary = f.exports.qualityRecordSummary([record, record, confirmed, pending]);
  assert.equal(summary.records.length, 3);
  assert.deepEqual(summary.units, [{ unit: '件', inspected: 200, defective: 12 }, { unit: '台', inspected: 10, defective: 2 }]);
  assert.deepEqual(summary.causes, [{ category: 'unknown', unit: '件', defective: 6, records: 1 }, { category: 'process', unit: '件', defective: 6, records: 1 }, { category: 'unknown', unit: '台', defective: 2, records: 1 }]);
  assert.equal(summary.occurrences, 24);
  assert.equal(summary.unknown, 2);
});

test('供应商比较一次只展示同一物料 ID 与单位，切换筛选后回落至有效分组', () => {
  const records = [record, { ...record, id: 'q2', supplierId: 's2', supplierName: '供应商乙' }, { ...record, id: 'q3', materialId: 'm2', supplierName: '同名不同物料' }, { ...record, id: 'q4', unit: '套', supplierName: '同名不同单位' }];
  const f = fixture('QualityRecordsPanel', { records, onSaved() {} });
  const comparison = () => control(f, '同物料供应商比较');
  const body = () => nodes(comparison()).find(row => row.type === 'TableBody');
  assert.match(text(body()), /供应商甲/); assert.match(text(body()), /供应商乙/);
  assert.doesNotMatch(text(body()), /同名不同物料|同名不同单位/);
  control(f, '供应商比较物料').props.onChange({ target: { value: JSON.stringify(['m2', '件']) } });
  assert.match(text(body()), /同名不同物料/); assert.doesNotMatch(text(body()), /供应商甲/);
  control(f, '搜索质量异常').props.onChange({ target: { value: '供应商乙' } });
  assert.equal(control(f, '供应商比较物料').props.value, JSON.stringify(['m1', '件']));
  assert.match(text(body()), /供应商乙/);
  assert.match(text(f.render()), /不代表全部来料质量率/);
});

test('主因图切换单位只显示当前单位数量，空样本不显示虚构不良率', () => {
  const f = fixture('QualityRecordsPanel', { records: [record, { ...record, id: 'q2', unit: '台', inspectedQty: 0, defectiveQty: 0 }], onSaved() {} });
  control(f, '主因分布单位').props.onChange({ target: { value: '台' } });
  const bars = nodes(control(f, '不良主因分布')).filter(row => row.type === 'progress');
  assert.equal(bars.length, 1); assert.equal(bars[0].props.value, 0); assert.match(bars[0].props['aria-label'], /台/);
  assert.doesNotMatch(text(f.render()), /NaN|Infinity/);
});

test('只读详情保留附件预览和验证记录入口，不提供原因与处置写入', async () => {
  const calls = [];
  const row = { ...record, analysis: { ...analysis, files: [{ fileId: 'file1', name: '现场照片.png', mime: 'image/png', size: 100 }] } };
  const f = fixture('QualityAnalysisContent', { id: 'q1', onClose() {}, onSaved() {} }, {
    '../../lib/procurementOperationsApi': { getQualityAnalysis: async () => response(row), getQualityAttachment: async (...args) => { calls.push(args); return { id: 'file1', name: '现场照片.png', url: '/saved-file' }; } },
  });
  f.render(); await flush();
  assert.equal(nodes(f.render()).filter(row => row.type === 'fieldset').every(row => row.props.disabled), true);
  assert.equal(button(f, '确认主因与责任'), undefined); assert.equal(control(f, '处置结果'), undefined);
  await button(f, '现场照片.png').props.onClick(); await flush();
  assert.deepEqual(calls, [['q1', 'file1']]); assert.ok(nodes(f.render()).some(row => row.type === 'AttachmentPreviewDialog'));
  button(f, '查看验证记录').props.onClick();
  const verify = nodes(f.render()).find(row => row.type === 'QualityVerificationDialog');
  assert.equal(verify.props.canVerify, false); assert.equal(verify.props.record.id, 'q1');
});

test('待分析可保存未知主因，处置改动先保存再复验，仍提交原异常版本', async () => {
  const writes = [];
  const f = fixture('QualityAnalysisContent', { id: 'q1', onClose() {}, onSaved() {} }, {
    '../../hooks/usePermission': { usePermission: key => ['proc-quality:manage', 'proc-quality:verify'].includes(key) },
    '../../lib/procurementOperationsApi': { getQualityAnalysis: async () => response(record), saveQualityAnalysis: async (...args) => writes.push(args) },
  });
  f.render(); await flush();
  control(f, '质量处置方式').props.onChange({ target: { value: 'rework' } });
  control(f, '处置结果').props.onChange({ target: { value: '返工完成，申请复验' } });
  assert.equal(button(f, '独立复验').props.disabled, true);
  button(f, '保存待分析').props.onClick(); await flush();
  assert.equal(writes[0][0], 'q1'); assert.equal(writes[0][1].action, 'save');
  assert.equal(writes[0][1].baseUpdatedAt, record.updatedAt); assert.equal(writes[0][1].version, 1);
  assert.equal(writes[0][1].data.category, 'unknown'); assert.equal(writes[0][1].data.detail, '');
  assert.equal(writes[0][1].data.disposition, 'rework');
});

test('原异常协同回复保留经办人校验与原生产计划版本', async () => {
  const writes = [];
  const row = { ...record, source: 'production', collaboration: { ownerId: 'worker', ownerName: '经办甲', originatorName: '现场乙', phase: 'waiting_reply', department: '研发部', priority: 'high', reply: null } };
  const f = fixture('QualityAnalysisContent', { id: 'q1', onClose() {}, onSaved() {} }, {
    '../../hooks/usePermission': { usePermission: key => key === 'proc-quality:collaborate' },
    '../../lib/procurementOperationsApi': { getQualityAnalysis: async () => ({ ...response(row), productionSource: { planId: 'p1', planVersion: 7 } }) },
    '../../lib/productionExecutionApi': { commandExecutionPlan: async (...args) => writes.push(args) },
  });
  f.render(); await flush();
  control(f, '回复原质量异常').props.onChange({ target: { value: '实物分析已补充' } });
  button(f, '回复原异常').props.onClick(); await flush();
  assert.equal(writes[0][0], 'p1'); assert.equal(writes[0][1].version, 7);
  assert.equal(writes[0][1].action, 'reply-quality'); assert.equal(writes[0][1].data.qualityId, 'q1');
  assert.match(text(f.render()), /协同部门：研发部/); assert.match(text(f.render()), /优先级：高/);
});
