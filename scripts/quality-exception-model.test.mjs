import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

const source = readFileSync(new URL('../src/app/procurement/quality/qualityExceptionPreviewModel.ts', import.meta.url), 'utf8');
const code = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
const noSideEffect = () => { throw new Error('演示模型不能调用接口或持久化'); };
const noStorage = new Proxy({}, { get: noSideEffect, set: noSideEffect });
const model = {};
new Function('exports', 'crypto', 'fetch', 'localStorage', 'sessionStorage', 'indexedDB', code)(model, { randomUUID }, noSideEffect, noStorage, noStorage, noStorage);
const { createQualityPreviewState, createQualityIssue, applyQualityAction, allowedQualityActions, qualityCloseBlockers, qualityVerificationBlockers } = model;
const now = '2026-09-10T01:00:00.000Z';
const createInput = (patch = {}) => ({ source: 'incoming', discoveredDate: '2026-09-10', materialCode: 'DEMO-NEW-MAT', materialName: '演示新物料', category: '机加工件', spec: '', unit: '件', supplierName: '演示供应商', batchNo: 'DEMO-NEW-BATCH', orderNo: '', inspectedQty: 10, defectiveQty: 2, phenomenon: '演示现象', evidence: '演示证据说明', ...patch });
const actionInput = (kind, patch = {}) => ({ ...{
  assign: { kind, owner: '演示采购员', verifier: '演示质量员', dueDate: '2026-09-12', note: '演示分派说明' },
  cause: { kind, category: 'process', detail: '演示主因说明', responsibility: '演示人工责任认定', evidence: '演示确认依据' },
  disposition: { kind, method: 'repair', handledQty: 2, detail: '演示处置过程', evidence: '演示处置依据' },
  submit_verification: { kind, note: '演示提交说明' },
  verify: { kind, quantity: 2, result: 'passed', note: '演示复检结论', evidence: '演示验证依据' },
  close: { kind, note: '演示关闭说明' },
  feedback: { kind, source: 'production', reference: 'DEMO-FEEDBACK-1', note: '演示关联说明' },
}[kind], kind, ...patch });
const fresh = (patch = {}) => createQualityIssue({ issues: [], records: [] }, createInput(patch), now);
const act = (state, kind, patch = {}, index = 0, time = now) => applyQualityAction(state, state.issues[index].id, state.issues[index].version, actionInput(kind, patch), time);
const through = (...kinds) => kinds.reduce((state, kind) => act(state, kind), fresh());
const freeze = (value) => { Object.freeze(value); for (const nested of Object.values(value)) if (nested && typeof nested === 'object' && !Object.isFrozen(nested)) freeze(nested); return value; };

test('六条演示例覆盖所有状态，每条历史真实推导最终状态、版本和证据', () => {
  const state = createQualityPreviewState();
  assert.deepEqual(state.issues.map((issue) => issue.status), ['unassigned', 'processing', 'awaiting_verification', 'awaiting_close', 'processing', 'closed']);
  assert.deepEqual(state.issues.map((issue) => issue.id), Array.from({ length: 6 }, (_, i) => `demo-quality-00${i + 1}`));
  assert.equal(state.issues[0].receiptId, 'demo-receipt-001'); assert.equal(state.issues[0].orderNo, 'DEMO-PO-001');
  assert.equal(state.issues[3].unit, '台'); assert.equal(state.issues[4].causeCategory, 'process');
  assert.equal(state.issues[1].causeCategory, ''); assert.equal(state.issues[1].responsibility, '');
  for (const issue of state.issues) {
    assert.match(issue.code, /^DEMO-NC-/); assert.match(issue.materialCode, /^DEMO-/); assert.match(issue.batchNo, /^DEMO-/); assert.match(issue.supplierName, /演示/);
    const history = state.records.filter((record) => record.issueId === issue.id).toReversed();
    assert.equal(history[0].kind, 'create'); assert.equal(history.length - 1, issue.version);
    let status = 'unassigned';
    for (const record of history) { assert.equal(record.beforeStatus, status); status = record.afterStatus; assert.match(record.actor, /演示/); }
    assert.equal(status, issue.status);
    if (['awaiting_close', 'closed'].includes(issue.status)) assert.deepEqual(qualityCloseBlockers(issue), []);
    if (issue.status === 'awaiting_verification') assert.deepEqual(qualityVerificationBlockers(issue), []);
  }
  state.issues[0].linkedFeedback.push({ source: 'incoming', reference: 'modified', note: '' }); state.records[0].details[0].value = 'modified';
  const independent = createQualityPreviewState(); assert.equal(independent.issues[0].linkedFeedback.length, 0); assert.notEqual(independent.records[0].details[0].value, 'modified');
});

test('状态开放动作明确且返回数组不会修改模型规则', () => {
  const state = createQualityPreviewState();
  assert.deepEqual(state.issues.map(allowedQualityActions), [
    ['assign', 'feedback'], ['assign', 'cause', 'disposition', 'submit_verification', 'feedback'], ['verify', 'feedback'], ['close', 'feedback'], ['assign', 'cause', 'disposition', 'submit_verification', 'feedback'], [],
  ]);
  allowedQualityActions(state.issues[0]).push('close'); assert.deepEqual(allowedQualityActions(state.issues[0]), ['assign', 'feedback']);
  assert.throws(() => act(state, 'cause'), /当前异常状态/); assert.throws(() => act(state, 'feedback', {}, 5), /当前异常状态/);
  assert.throws(() => act(state, 'invalid'), /当前异常状态/);
});

test('完整演示闭环保存原因、处置、复检和关闭记录，保持原始数量不变', () => {
  const original = fresh(); let state = original;
  for (const kind of ['assign', 'cause', 'disposition', 'submit_verification', 'verify', 'close']) state = act(state, kind);
  assert.equal(state.issues[0].status, 'closed'); assert.equal(state.issues[0].verificationRound, 1); assert.equal(state.issues[0].version, 6);
  assert.equal(state.issues[0].inspectedQty, 10); assert.equal(state.issues[0].defectiveQty, 2); assert.equal(state.issues[0].handledQty, 2);
  assert.equal(state.issues[0].closeNote, '演示关闭说明'); assert.deepEqual(qualityCloseBlockers(state.issues[0]), []);
  assert.match(state.records[0].details.find((item) => item.label === '业务影响').value, /不生成库存流水/);
  assert.deepEqual(original.issues[0].status, 'unassigned'); assert.equal(original.records.length, 1);
});

test('新增异常保留输入白名单，不接纳伪造状态、责任、收货或库存字段', () => {
  const state = createQualityIssue({ issues: [], records: [] }, createInput({ status: 'closed', responsibility: '伪造', handledQty: 20, receiptId: 'real-receipt', stock: 99, materialName: '  演示物料  ' }), now);
  const issue = state.issues[0]; assert.equal(issue.materialName, '演示物料'); assert.equal(issue.status, 'unassigned'); assert.equal(issue.responsibility, ''); assert.equal(issue.receiptId, ''); assert.equal(issue.handledQty, 0); assert.equal(issue.stock, undefined);
  assert.match(issue.id, /^demo-quality-/); assert.equal(issue.code, 'DEMO-NC-001');
  const next = createQualityIssue(state, createInput({ batchNo: 'DEMO-OTHER-BATCH' }), now); assert.equal(next.issues[0].code, 'DEMO-NC-002');
});

test('物料加批次去空格且忽略大小写防重复，包括不同来源与已关闭异常', () => {
  const state = fresh();
  for (const source of ['incoming', 'warehouse', 'production', 'after_sales']) assert.throws(() => createQualityIssue(state, createInput({ source, materialCode: ' demo-new-mat ', batchNo: 'demo-new-batch' }), now), /DEMO-NC-001.*关联反馈.*重复统计/);
  const closed = through('assign', 'cause', 'disposition', 'submit_verification', 'verify', 'close');
  assert.throws(() => createQualityIssue(closed, createInput(), now), /已关闭异常.*查看原记录.*不支持重开/);
  assert.equal(createQualityIssue(state, createInput({ batchNo: 'DEMO-SECOND-BATCH' }), now).issues.length, 2);
});

test('关联反馈不累加不良或处置数量，相同来源单号去空格忽略大小写去重', () => {
  const state = fresh(); const linked = act(state, 'feedback', { reference: '  DEMO-FB-001  ', note: ' 补充照片说明 ', defectiveQty: 100, handledQty: 50, status: 'closed' });
  assert.equal(linked.issues[0].inspectedQty, 10); assert.equal(linked.issues[0].defectiveQty, 2); assert.equal(linked.issues[0].handledQty, 0); assert.equal(linked.issues[0].status, 'unassigned');
  assert.deepEqual(linked.issues[0].linkedFeedback, [{ source: 'production', reference: 'DEMO-FB-001', note: '补充照片说明' }]);
  assert.throws(() => act(linked, 'feedback', { reference: 'demo-fb-001' }), /已关联/);
  assert.equal(act(linked, 'feedback', { source: 'warehouse', reference: 'DEMO-FB-001' }).issues[0].linkedFeedback.length, 2);
  assert.equal(state.issues[0].linkedFeedback.length, 0);
});

test('分派与人工责任认定独立，逾期截止日期允许但不能早于发现日期', () => {
  const state = fresh({ discoveredDate: '2026-09-01' }); const assigned = act(state, 'assign', { dueDate: '2026-09-02', responsibility: '不能由分派写入' });
  assert.equal(assigned.issues[0].owner, '演示采购员'); assert.equal(assigned.issues[0].responsibility, '');
  const confirmed = act(assigned, 'cause'); const reassigned = act(confirmed, 'assign', { owner: '演示生产主管', responsibility: '错误自动值' });
  assert.equal(reassigned.issues[0].responsibility, confirmed.issues[0].responsibility);
  for (const dueDate of ['', '2026-02-30', '2026-9-10']) assert.throws(() => act(state, 'assign', { dueDate }), /有效的处理期限/);
  assert.throws(() => act(state, 'assign', { dueDate: '2026-08-31' }), /不能早于发现日期/);
});

test('累计处置不得倒减、超量，三位小数有效且重复总量仅更新处置证据', () => {
  let state = act(fresh({ defectiveQty: 0.3 }), 'assign'); state = act(state, 'disposition', { handledQty: 0.1 });
  assert.throws(() => act(state, 'disposition', { handledQty: 0.099 }), /不能低于/);
  assert.throws(() => act(state, 'disposition', { handledQty: 0.301 }), /不能超过/);
  const same = act(state, 'disposition', { handledQty: 0.1, detail: '演示处置证据补充' }); assert.equal(same.issues[0].handledQty, 0.1);
  const full = act(same, 'disposition', { handledQty: 0.3 }); assert.equal(full.issues[0].handledQty, 0.3); assert.equal(full.issues[0].defectiveQty, 0.3);
});

test('复检提交必须分派、主因和全量处置证据完成', () => {
  let state = through('assign'); assert.ok(qualityVerificationBlockers(state.issues[0]).length >= 3);
  assert.throws(() => act(state, 'submit_verification'), /人工原因确认/);
  state = act(state, 'cause'); assert.throws(() => act(state, 'submit_verification'), /处置方式/);
  state = act(state, 'disposition', { handledQty: 1 }); assert.throws(() => act(state, 'submit_verification'), /覆盖全部不良量/);
  state = act(state, 'disposition'); const submitted = act(state, 'submit_verification');
  assert.equal(submitted.issues[0].verificationRound, 1); assert.equal(submitted.issues[0].verificationResult, 'pending'); assert.equal(submitted.issues[0].status, 'awaiting_verification');
});

test('未通过复检退回处理，必须重新登记处置后开启新一轮，保留失败历史', () => {
  let state = through('assign', 'cause', 'disposition', 'submit_verification');
  state = act(state, 'verify', { quantity: 1, result: 'failed', note: '第1轮未通过', evidence: 'DEMO-FAILED-EVIDENCE' });
  assert.equal(state.issues[0].status, 'processing'); assert.equal(state.issues[0].handledQty, 2); assert.equal(state.issues[0].verificationResult, 'failed');
  assert.throws(() => act(state, 'submit_verification'), /先重新登记处置/);
  const recause = act(state, 'cause', { detail: '演示补充原因' }); assert.throws(() => act(recause, 'submit_verification'), /先重新登记处置/);
  state = act(recause, 'disposition', { detail: '演示第二次处置', evidence: 'DEMO-REDO-EVIDENCE' });
  assert.equal(state.issues[0].verificationResult, 'pending'); assert.equal(state.issues[0].verificationQty, 0); assert.equal(state.issues[0].verificationNote, ''); assert.equal(state.issues[0].verificationEvidence, '');
  state = act(state, 'submit_verification'); assert.equal(state.issues[0].verificationRound, 2);
  state = act(state, 'verify'); state = act(state, 'close'); assert.equal(state.issues[0].status, 'closed');
  assert.equal(state.records.filter((record) => record.kind === 'verify').length, 2);
  assert.ok(state.records.find((record) => record.summary.includes('第 1 轮') && record.summary.includes('未通过')).details.some((item) => item.value === 'DEMO-FAILED-EVIDENCE'));
});

test('通过复检要求全量；失败允许局部，但两者都拒绝超量与空证据', () => {
  const state = through('assign', 'cause', 'disposition', 'submit_verification');
  assert.throws(() => act(state, 'verify', { quantity: 1 }), /覆盖全部/);
  assert.throws(() => act(state, 'verify', { quantity: 2.001 }), /不能超过/);
  assert.throws(() => act(state, 'verify', { result: 'invalid' }), /有效的复检结果/);
  for (const result of ['passed', 'failed']) for (const field of ['note', 'evidence']) assert.throws(() => act(state, 'verify', { result, [field]: '  ' }), /请填写/);
  assert.equal(act(state, 'verify', { result: 'failed', quantity: 0.001 }).issues[0].status, 'processing');
});

test('关闭缺失前置证据会阻止，不能靠待关闭状态绕过检查', () => {
  const ready = through('assign', 'cause', 'disposition', 'submit_verification', 'verify');
  for (const patch of [{ handledQty: 1 }, { verificationQty: 1 }, { verificationResult: 'pending' }, { verificationRound: 0 }, { verificationEvidence: '' }, { causeEvidence: '' }, { dispositionEvidence: '' }, { responsibility: '' }, { owner: '' }, { verifier: '' }]) {
    const invalid = { ...ready, issues: [{ ...ready.issues[0], ...patch }] };
    assert.ok(qualityCloseBlockers(invalid.issues[0]).length); assert.throws(() => act(invalid, 'close'));
  }
  assert.throws(() => act(ready, 'close', { note: '  ' }), /关闭说明/);
});

test('创建必填字段、有效来源、文本长度与可空字段按契约验证', () => {
  for (const field of ['materialCode', 'materialName', 'category', 'unit', 'supplierName', 'batchNo', 'phenomenon', 'evidence']) assert.throws(() => fresh({ [field]: '  ' }), /请填写/);
  for (const field of ['materialCode', 'materialName', 'category', 'spec', 'supplierName', 'batchNo', 'orderNo']) assert.throws(() => fresh({ [field]: '字'.repeat(121) }), /120 个字符/);
  assert.throws(() => fresh({ unit: '字'.repeat(21) }), /20 个字符/);
  for (const field of ['phenomenon', 'evidence']) { assert.throws(() => fresh({ [field]: '字'.repeat(2001) }), /2000 个字符/); assert.equal(fresh({ [field]: '字'.repeat(2000) }).issues[0][field].length, 2000); }
  assert.throws(() => fresh({ source: 'invalid' }), /有效的异常来源/);
  assert.equal(fresh({ spec: '', orderNo: '' }).issues[0].orderNo, '');
});

test('创建数量与动作数量拒绝非正数、非有限数、不安全数和四位小数', () => {
  for (const value of [0, -1, Infinity, NaN, 0.0001, 1.0001, Number.MAX_VALUE, '1']) {
    for (const field of ['inspectedQty', 'defectiveQty']) assert.throws(() => fresh({ [field]: value }), /大于 0.*三位/);
    assert.throws(() => act(through('assign'), 'disposition', { handledQty: value }), /大于 0.*三位/);
    assert.throws(() => act(through('assign', 'cause', 'disposition', 'submit_verification'), 'verify', { quantity: value }), /大于 0.*三位/);
  }
  assert.throws(() => fresh({ inspectedQty: 1, defectiveQty: 1.001 }), /不能超过检验数量/);
  assert.equal(fresh({ inspectedQty: 0.001, defectiveQty: 0.001 }).issues[0].defectiveQty, 0.001);
});

test('发现日期须有效且按北京时间今天，动作不得发生于发现之前', () => {
  for (const date of ['', '2026-02-30', '2026-9-10', 'not-a-date']) assert.throws(() => fresh({ discoveredDate: date }), /有效的发现日期/);
  const empty = { issues: [], records: [] };
  assert.throws(() => createQualityIssue(empty, createInput(), '2026-09-09T15:59:59Z'), /北京今天/);
  assert.equal(createQualityIssue(empty, createInput(), '2026-09-09T16:00:00Z').issues[0].discoveredDate, '2026-09-10');
  assert.throws(() => createQualityIssue(empty, createInput(), 'invalid'), /演示时间无效/);
  assert.throws(() => act(fresh(), 'assign', {}, 0, '2026-09-09T15:59:59Z'), /不能早于发现日期/);
  assert.throws(() => act(fresh(), 'assign', {}, 0, 'invalid'), /演示时间无效/);
});

test('每种动作验证必填和长度，保存字段不会从其他动作草稿串入', () => {
  const states = { assign: fresh(), cause: through('assign'), disposition: through('assign'), submit_verification: through('assign', 'cause', 'disposition'), verify: through('assign', 'cause', 'disposition', 'submit_verification'), close: through('assign', 'cause', 'disposition', 'submit_verification', 'verify'), feedback: fresh() };
  const fields = { assign: ['owner', 'verifier', 'note'], cause: ['detail', 'responsibility', 'evidence'], disposition: ['detail', 'evidence'], submit_verification: ['note'], verify: ['note', 'evidence'], close: ['note'], feedback: ['reference', 'note'] };
  for (const [kind, names] of Object.entries(fields)) for (const field of names) {
    assert.throws(() => act(states[kind], kind, { [field]: '  ' }), /请填写/);
    const max = ['owner', 'verifier', 'reference'].includes(field) ? 120 : 2000;
    assert.throws(() => act(states[kind], kind, { [field]: '字'.repeat(max + 1) }), new RegExp(`${max} 个字符`));
  }
  assert.throws(() => act(states.cause, 'cause', { category: 'invalid' }), /有效的主因类别/);
  assert.throws(() => act(states.disposition, 'disposition', { method: 'invalid' }), /有效的处置方式/);
  assert.throws(() => act(states.feedback, 'feedback', { source: 'invalid' }), /有效的异常来源/);
  const isolated = act(states.cause, 'cause', { owner: '串入人员', handledQty: 100, verificationResult: 'passed', closeNote: '串入' }).issues[0];
  assert.equal(isolated.owner, '演示采购员'); assert.equal(isolated.handledQty, 0); assert.equal(isolated.verificationResult, 'pending'); assert.equal(isolated.closeNote, '');
});

test('版本防止重复保存旧草稿，不存在异常拒绝，成功历史标识不重复', () => {
  const state = fresh(); const saved = act(state, 'assign');
  assert.throws(() => applyQualityAction(saved, state.issues[0].id, state.issues[0].version, actionInput('assign'), now), /版本已变化/);
  assert.throws(() => applyQualityAction(saved, 'missing', 0, actionInput('assign'), now), /未找到演示质量异常/);
  assert.equal(saved.issues[0].version, 1); assert.equal(saved.records.length, 2);
  assert.equal(new Set(saved.records.map((record) => record.id)).size, 2);
  assert.equal(saved.records[0].createdAt, now); assert.equal(saved.records[0].actor, '演示操作员');
});

test('纯状态转换不修改冻结输入，禁止访问接口及持久化，无库存实体', () => {
  assert.doesNotMatch(code, /\brequire\s*\(/); assert.doesNotMatch(source, /\b(?:fetch|XMLHttpRequest|WebSocket|localStorage|sessionStorage|indexedDB)\b/);
  const state = freeze(createQualityPreviewState()); const draft = freeze(actionInput('assign', { owner: ' 演示采购员 ', note: ' 演示说明 ' }));
  const saved = applyQualityAction(state, state.issues[0].id, state.issues[0].version, draft, now);
  assert.notEqual(saved, state); assert.notEqual(saved.issues, state.issues); assert.notEqual(saved.records, state.records); assert.notEqual(saved.issues[0], state.issues[0]);
  assert.equal(saved.issues[1], state.issues[1]); assert.deepEqual(saved.records.slice(1), state.records);
  assert.equal(saved.issues[0].owner, '演示采购员'); assert.equal(state.issues[0].owner, ''); assert.equal(state.issues[0].status, 'unassigned');
  assert.deepEqual(Object.keys(saved).sort(), ['issues', 'records']);
  assert.doesNotMatch(Object.keys(saved.issues[0]).join(' '), /stock|inventory|erp/i);
  assert.throws(() => applyQualityAction(state, state.issues[0].id, state.issues[0].version, actionInput('assign', { note: '' }), now));
  assert.equal(state.issues[0].version, 0);
});
