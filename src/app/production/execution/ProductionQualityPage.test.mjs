import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

function compile(file, require = () => ({})) {
  const code = ts.transpileModule(readFileSync(new URL(file, import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const exports = {}; new Function('require', 'exports', code)(require, exports); return exports;
}
const state = compile('./productionViewState.ts');
const record = { id: 'original', source: 'production', issue: '装配干涉', inspectedQty: 20, defectiveQty: 2, unit: '件', status: 'open', disposition: 'pending', updatedAt: '2026-10-09T08:00:00Z', inspectionDate: '2026-10-09', createdByName: '现场甲' };
const task = { id: 'task1', batchId: 'batch1', name: '阀组件装配', line: '一线', ownerName: '现场甲', inspections: [], fieldIssues: [{ quality: record }] };
const plan = { id: 'plan1', productLine: 'Q7', tasks: [task], batches: [{ id: 'batch1', code: 'B-1009' }] };
const element = (type, props) => ({ type, props: props || {} });
const nodes = tree => Array.isArray(tree) ? tree.flatMap(nodes) : tree && typeof tree === 'object' && tree.props ? [tree, ...nodes(tree.props.children)] : [];
const text = tree => Array.isArray(tree) ? tree.map(text).join('') : tree && typeof tree === 'object' && tree.props ? text(tree.props.children) : tree == null ? '' : String(tree);
function fixture({ permissions = [], query = '', plans = [plan], userId = 'user', collaborationOnly = false } = {}) {
  let params = new URLSearchParams(query), cursor = 0;
  const slots = [], edits = [], verifications = [];
  const controls = Object.fromEntries(['Button', 'Input', 'NativeSelect', 'QualityAnalysisDialog', 'QualityVerificationDialog', 'AttachmentPreviewDialog', 'ArrowRight', 'Check', 'ClipboardCheck', 'FileText', 'Image', 'MessageSquare', 'Search', 'Users'].map(name => [name, name]));
  const module = compile('./ProductionQualityPage.tsx', name => {
    if (name === 'react') return { useEffect() {}, useState(initial) { const i = cursor++; if (!(i in slots)) slots[i] = initial; return [slots[i], value => { slots[i] = typeof value === 'function' ? value(slots[i]) : value; }]; } };
    if (name === 'react/jsx-runtime') return { jsx: element, jsxs: element, Fragment: 'Fragment' };
    if (name === 'react-router') return { Link: 'Link', useSearchParams: () => [params, change => { params = typeof change === 'function' ? change(params) : change; }] };
    if (name === '../../auth') return { useAuth: () => ({ user: { id: userId, permissions } }) };
    if (name.includes('usePermission')) return { usePermission: permission => permissions.includes(permission) };
    if (name.includes('productionViewState')) return state;
    if (name.includes('QualityRecordsPanel')) return { qualityRecordSummary: () => ({ top: [] }) };
    return controls;
  });
  return { module, edits, verifications, params: () => params, render() { cursor = 0; const node = module.ProductionQualityPage({ plans, collaborationOnly, onSaved() {}, onEdit: (...args) => edits.push(args), onVerify: row => verifications.push(row) }); return node.type(node.props); } };
}

test('生产异常按原编号去重，保留较新记录及真实生产单和工序', () => {
  const { module } = fixture();
  const newer = { ...record, updatedAt: '2026-10-09T09:00:00Z', status: 'processing' };
  const rows = module.productionQualityItems([{ ...plan, tasks: [{ ...task, inspections: [{ quality: newer, process: '气密检验' }] }] }]);
  assert.equal(rows.length, 1); assert.equal(rows[0].record, newer); assert.equal(rows[0].productionCode, 'B-1009'); assert.equal(rows[0].process, '气密检验');
});
test('P04 只纳入实际协同记录，不把主因或现场负责人猜成研发', () => {
  const { module } = fixture();
  assert.equal(module.productionQualityItems([plan], true).length, 0);
  const collaboration = { ownerId: 'buyer', ownerName: '采购甲', phase: 'waiting_reply' };
  const rows = module.productionQualityItems([{ ...plan, tasks: [{ ...task, fieldIssues: [{ quality: { ...record, collaboration } }] }] }], true);
  assert.equal(rows.length, 1); assert.equal(rows[0].record.collaboration.ownerName, '采购甲');
});
test('待复验必须有处置结果，协同回复和关闭状态优先于推算阶段', () => {
  const { module } = fixture();
  assert.equal(module.productionQualityState(record).label, '待处理');
  assert.equal(module.productionQualityState({ ...record, disposition: 'rework' }).label, '待处理');
  assert.equal(module.productionQualityState({ ...record, disposition: 'rework', resolution: '整改完成' }).label, '待复验');
  assert.equal(module.productionQualityState({ ...record, disposition: 'rework', resolution: '整改完成', collaboration: { phase: 'waiting_reply' } }).label, '待协同回复');
  assert.equal(module.productionQualityState({ ...record, collaboration: { phase: 'returned' } }).label, '已回复待处置');
  assert.equal(module.productionQualityState({ ...record, status: 'closed' }).label, '已关闭');
});
test('非法或无权异常深链不退回展示其他异常详情', () => {
  const f = fixture({ query: 'quality=missing' });
  assert.match(text(f.render()), /原异常不存在或无权查看/);
  assert.equal(nodes(f.render()).some(node => node.props['aria-label'] === '生产不良详情'), false);
});
test('转交按钮仅质量管理员可见，并发送原计划、作业和异常', () => {
  const read = fixture();
  assert.equal(nodes(read.render()).some(node => node.type === 'Button' && text(node).includes('转交协同')), false);
  const write = fixture({ permissions: ['proc-quality:manage'] });
  nodes(write.render()).find(node => node.type === 'Button' && text(node).includes('转交协同')).props.onClick();
  assert.equal(write.edits[0][0].id, plan.id); assert.equal(write.edits[0][1].task.id, task.id); assert.equal(write.edits[0][1].quality.id, record.id); assert.equal(write.edits[0][1].action, 'assign-quality');
});
test('回复按钮只给真实协同接收人；普通读者仍可看验证记录', () => {
  const plans = [{ ...plan, tasks: [{ ...task, fieldIssues: [{ quality: { ...record, collaboration: { ownerId: 'receiver', ownerName: '接收甲', phase: 'waiting_reply' } } }] }] }];
  for (const userId of ['receiver', 'other']) {
    const f = fixture({ plans, userId, permissions: ['proc-quality:collaborate'] });
    assert.equal(nodes(f.render()).some(node => node.type === 'Button' && text(node) === '回复原异常'), userId === 'receiver');
  }
  const f = fixture(); nodes(f.render()).find(node => node.type === 'Button' && text(node).includes('查看验证记录')).props.onClick(); assert.equal(f.verifications[0].id, record.id);
});
test('原作业链接保留月份并携带原质量编号，不创建第二份异常', () => {
  const f = fixture({ query: 'month=2026-10&view=quality' });
  const link = nodes(f.render()).find(node => node.type === 'Link');
  const params = new URLSearchParams(link.props.to.slice(1));
  assert.equal(params.get('month'), '2026-10'); assert.equal(params.get('plan'), plan.id); assert.equal(params.get('task'), task.id); assert.equal(params.get('quality'), record.id); assert.equal(params.get('taskSection'), 'quality');
});
test('现场建议与初步原因可见但不冒充当前协同人，负责人可沿原异常采纳建议', () => {
  const plans=[{...plan,events:[{id:'e1',subjectId:record.id,action:'field-issue',actorName:'现场甲',at:'2026-10-09T08:00:00Z',reason:'现场提报依据'}],tasks:[{...task,fieldIssues:[{qualityId:record.id,quality:record,initialCause:'software',requestedCollaboration:{department:'研发部',ownerId:'rd1',ownerName:'研发甲'}}]}]}];
  const f=fixture({plans,permissions:['proc-quality:manage']});const tree=f.render();
  assert.match(text(tree),/现场初步原因软件/);assert.match(text(tree),/当前协同人尚未转交/);assert.match(text(tree),/现场建议：研发部 · 研发甲/);assert.match(text(tree),/待负责人初判、分派/);assert.match(text(tree),/现场提报依据/);
  nodes(tree).find(node=>node.type==='Button'&&text(node)==='采纳建议并办理转交').props.onClick();
  assert.equal(f.edits[0][1].quality.id,record.id);assert.equal(f.edits[0][1].task.fieldIssues[0].requestedCollaboration.ownerId,'rd1');
  assert.equal(f.module.productionQualityItems(plans,true).length,0);
});
