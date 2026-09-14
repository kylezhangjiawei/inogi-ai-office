import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

const source = readFileSync(new URL('../src/app/procurement/warehouse/warehousePreviewModel.ts', import.meta.url), 'utf8');
const code = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
const forbidden = () => { throw new Error('仓库演示不能访问接口或持久化'); };
const storage = new Proxy({}, { get: forbidden, set: forbidden });
const model = {};
new Function('exports', 'fetch', 'localStorage', 'sessionStorage', 'indexedDB', code)(model, forbidden, storage, storage, storage);
const { createWarehouseState, applyWarehouseAction, freeStock, lineBalance, returnableQty, warehouseSeedIds: ids } = model;
const now = '2026-09-11T03:00:00.000Z';
const actor = '演示仓管员';
const input = (kind, patch = {}) => ({ actor, note: '演示核对说明', ...{
  issue: { dispatchId: ids.valveDispatch, lotId: ids.valveLot, quantity: 20 },
  sign: { issueId: ids.pendingIssue, actualQty: 20 },
  return_create: { issueId: ids.signedIssue, quantity: 5, result: 'inspection', evidence: '演示退料依据' },
  return_receive: { returnId: ids.defectiveReturn, actualQty: 6, result: 'defective', reviewed: false, evidence: '演示接收依据' },
  return_discrepancy: { returnId: ids.defectiveReturn, actualQty: 5 },
  return_resubmit: { returnId: ids.defectiveReturn, quantity: 5 },
  count_create: { lotId: ids.valveLot, bucket: 'qualified', actualQty: 198, evidence: '演示盘点依据' },
  count_edit: { countId: ids.draftCount, actualQty: 198, evidence: '演示补充盘点依据' },
  count_submit: { countId: ids.draftCount },
  count_approve: { countId: ids.draftCount, actor: '演示复核人' },
  count_reject: { countId: ids.draftCount, actor: '演示复核人' },
}[kind], kind, ...patch });
const act = (state, kind, patch = {}, version = state.version) => applyWarehouseAction(state, version, input(kind, patch), now);
const lot = (state, id = ids.valveLot) => state.lots.find((item) => item.id === id);
const issue = (state, id = ids.signedIssue) => state.issues.find((item) => item.id === id);
const ret = (state, id = ids.defectiveReturn) => state.returns.find((item) => item.id === id);
const count = (state, id = ids.draftCount) => state.counts.find((item) => item.id === id);
const freeze = (value) => { Object.freeze(value); for (const item of Object.values(value)) if (item && typeof item === 'object' && !Object.isFrozen(item)) freeze(item); return value; };

test('期初、发料和签收种子推导现存与线边，多个退料申请预留可退数量', () => {
  const state = createWarehouseState();
  assert.equal(lot(state).qualified, 200); assert.equal(freeStock(lot(state)), 180);
  assert.equal(lot(state).inspection, 10); assert.equal(lot(state).defective, 24); assert.equal(lot(state).frozen, 5);
  assert.equal(state.movements.filter((item) => item.lotId === ids.valveLot).reduce((sum, item) => sum + item.quantity, 0), 200);
  assert.equal(lineBalance(issue(state)), 30); assert.equal(lineBalance(issue(state, ids.pendingIssue)), 0);
  assert.equal(returnableQty(state, ids.signedIssue), 14); assert.equal(returnableQty(state, ids.pendingIssue), 0);
  assert.equal(returnableQty(state, ids.signedIssue, ids.defectiveReturn), 20);
  assert.equal(state.dispatches[0].issuedQty, state.issues.reduce((sum, item) => sum + item.quantity, 0));
  assert.equal(count(state).lotVersion, lot(state).version);
  lot(state).qualified = 999; assert.equal(lot(createWarehouseState()).qualified, 200);
});

test('发料只扣合格可用库存，独立签收不再扣库，保留原状态和历史', () => {
  const original = freeze(createWarehouseState());
  const state = act(original, 'issue'); const created = state.issues.at(-1);
  assert.equal(lot(state).qualified, 180); assert.equal(freeStock(lot(state)), 160); assert.equal(lot(state).reserved, 20);
  assert.equal(state.dispatches[0].issuedQty, 80); assert.equal(created.status, 'pending_signature'); assert.equal(lineBalance(created), 0);
  assert.equal(state.movements.at(-1).quantity, -20); assert.equal(state.records.length, original.records.length + 1);
  const signed = act(state, 'sign', { issueId: created.id, actor: '演示线长' });
  assert.equal(lot(signed).qualified, 180); assert.equal(lot(signed).version, lot(state).version);
  assert.equal(lineBalance(issue(signed, created.id)), 20); assert.equal(signed.movements.at(-1).quantity, 0);
  assert.equal(lot(original).qualified, 200); assert.equal(original.issues.length, 2);
  assert.throws(() => act(signed, 'sign', { issueId: created.id }), /不能重复签收/);
});

test('发料要求物料和单位匹配、BOM 用量一致、满足剩余需求及未预留库存', () => {
  const state = createWarehouseState();
  assert.throws(() => act(state, 'issue', { lotId: ids.screenLot }), /匹配/);
  assert.throws(() => act(state, 'issue', { quantity: 61 }), /剩余物料需求/);
  assert.throws(() => act(state, 'issue', { lotId: ids.valveLotB, quantity: 41 }), /未预留可用/);
  assert.throws(() => act(state, 'issue', { dispatchId: ids.missingBomDispatch, lotId: ids.sealLot, quantity: 1 }), /BOM/);
  state.dispatches[0].requiredQty = 60;
  assert.throws(() => act(state, 'issue', { quantity: 1 }), /单耗与物料需求不一致/);
});

test('签收数量差异不计线边，核对一致后才签收，并保留差异历史', () => {
  const state = act(createWarehouseState(), 'sign', { actualQty: 18 });
  assert.equal(issue(state, ids.pendingIssue).status, 'discrepancy'); assert.equal(lineBalance(issue(state, ids.pendingIssue)), 0);
  assert.equal(state.movements.length, createWarehouseState().movements.length);
  const signed = act(state, 'sign');
  assert.equal(issue(signed, ids.pendingIssue).status, 'signed'); assert.equal(lineBalance(issue(signed, ids.pendingIssue)), 20);
  assert.equal(lot(signed).qualified, 200); assert.match(signed.records.at(-2).note, /应收 20，实收 18/);
});

test('退料申请仅占用可退额度，防止申请数量累计超过未耗用线边', () => {
  const original = createWarehouseState(); const state = act(original, 'return_create', { quantity: 14 });
  assert.equal(lot(state).qualified, 200); assert.equal(lineBalance(issue(state)), 30); assert.equal(returnableQty(state, ids.signedIssue), 0);
  assert.equal(state.movements.length, original.movements.length); assert.match(state.records.at(-1).note, /演示退料依据/);
  assert.throws(() => act(state, 'return_create', { quantity: 0.001 }), /可退数量/);
  assert.throws(() => act(original, 'return_create', { issueId: ids.pendingIssue }), /已签收/);
});

test('不良退料只增加不良隔离且线边扣一次，合格及报废不被重复增加', () => {
  const original = freeze(createWarehouseState()); const state = act(original, 'return_receive');
  assert.equal(ret(state).status, 'received'); assert.equal(ret(state).actualQty, 6);
  assert.equal(lot(state).defective, 30); assert.equal(lot(state).qualified, 200); assert.equal(lineBalance(issue(state)), 24);
  assert.equal(issue(state).returnedQty, 6); assert.equal(returnableQty(state, ids.signedIssue), 14);
  assert.equal(state.movements.at(-1).quantity, 6); assert.match(state.movements.at(-1).note, /不另计报废/);
  assert.throws(() => act(state, 'return_receive'), /不能重复入库/);
  assert.throws(() => act(state, 'return_discrepancy'), /待接收/);
  assert.equal(lot(original).defective, 24);
});

test('合格退料必须质量复核，待检和不良不能绕过复核直接回合格', () => {
  const state = createWarehouseState();
  assert.throws(() => act(state, 'return_receive', { result: 'qualified' }), /质量复核/);
  assert.throws(() => act(state, 'return_receive', { returnId: ids.qualifiedReturn, actualQty: 10, result: 'qualified' }), /质量复核/);
  const received = act(state, 'return_receive', { returnId: ids.qualifiedReturn, actualQty: 10, result: 'qualified', reviewed: true });
  assert.equal(lot(received).qualified, 210); assert.equal(freeStock(lot(received)), 190); assert.equal(lineBalance(issue(received)), 20);
  const pending = act(state, 'return_receive', { result: 'inspection' });
  assert.equal(lot(pending).inspection, 16); assert.equal(lot(pending).qualified, 200);
});

test('退料实际数量不一致需退回核对再更正，不更新库存或释放其他申请占用', () => {
  const original = createWarehouseState();
  assert.throws(() => act(original, 'return_receive', { actualQty: 5 }), /先退回核对/);
  assert.throws(() => act(original, 'return_discrepancy', { actualQty: 6 }), /数量一致/);
  const discrepancy = act(original, 'return_discrepancy');
  assert.equal(ret(discrepancy).status, 'discrepancy'); assert.equal(returnableQty(discrepancy, ids.signedIssue), 14);
  assert.equal(lineBalance(issue(discrepancy)), 30); assert.equal(lot(discrepancy).defective, 24);
  assert.throws(() => act(discrepancy, 'return_receive'), /仅待接收/);
  assert.throws(() => act(discrepancy, 'return_resubmit', { quantity: 21 }), /当前可退/);
  const corrected = act(discrepancy, 'return_resubmit');
  assert.equal(ret(corrected).quantity, 5); assert.equal(ret(corrected).actualQty, null); assert.equal(ret(corrected).status, 'pending');
  assert.equal(returnableQty(corrected, ids.signedIssue), 15);
  const received = act(corrected, 'return_receive', { actualQty: 5 });
  assert.equal(lot(received).defective, 29); assert.equal(lineBalance(issue(received)), 25);
  assert.match(received.records.at(-2).note, /由 6 更正为 5/); assert.match(received.records.at(-3).note, /申请 6，实点 5/);
});

test('盘点草稿、提交、独立复核按顺序完成，只在通过时生成一次差异流水', () => {
  const original = freeze(createWarehouseState()); const submitted = act(original, 'count_submit');
  assert.equal(lot(submitted).qualified, 200); assert.equal(count(submitted).status, 'pending_review');
  assert.equal(submitted.movements.length, original.movements.length);
  assert.throws(() => act(submitted, 'count_approve', { actor }), /填报人相同/);
  const approved = act(submitted, 'count_approve');
  assert.equal(count(approved).status, 'approved'); assert.equal(count(approved).reviewer, '演示复核人');
  assert.equal(lot(approved).qualified, 198); assert.equal(freeStock(lot(approved)), 178); assert.equal(approved.movements.at(-1).quantity, -2);
  assert.equal(approved.movements.at(-1).kind, 'adjustment'); assert.match(approved.movements.at(-1).note, /合格现存/);
  assert.deepEqual(approved.movements.slice(0, original.movements.length), original.movements);
  for (const kind of ['count_approve', 'count_edit', 'count_reject', 'count_submit']) assert.throws(() => act(approved, kind));
});

test('库存变化使盘点快照失效，修改实盘重新确认当前账面后才可提交', () => {
  const state = act(createWarehouseState(), 'issue');
  assert.throws(() => act(state, 'count_submit'), /库存已变化/);
  const edited = act(state, 'count_edit', { actualQty: 179, evidence: '重新清点依据' });
  assert.equal(count(edited).bookQty, 180); assert.equal(count(edited).lotVersion, lot(edited).version);
  assert.match(edited.records.at(-1).note, /原账面 200.*当前账面 180/);
  const approved = act(act(edited, 'count_submit'), 'count_approve');
  assert.equal(lot(approved).qualified, 179); assert.equal(approved.movements.at(-1).quantity, -1);
});

test('提交后库存变化需退回再更新快照，不得用旧差异覆盖新库存', () => {
  const stale = act(act(createWarehouseState(), 'count_submit'), 'issue');
  assert.throws(() => act(stale, 'count_approve'), /库存已变化/);
  assert.throws(() => act(stale, 'count_edit'), /草稿或退回/);
  const rejected = act(stale, 'count_reject'); assert.equal(lot(rejected).qualified, 180);
  assert.equal(count(rejected).status, 'rejected');
  assert.throws(() => act(rejected, 'count_submit'), /库存已变化/);
  const edited = act(rejected, 'count_edit', { actualQty: 181 });
  assert.equal(count(edited).status, 'draft'); assert.equal(count(edited).bookQty, 180);
  const approved = act(act(edited, 'count_submit'), 'count_approve');
  assert.equal(lot(approved).qualified, 181); assert.equal(approved.movements.at(-1).quantity, 1);
  assert.match(approved.records.at(-4).title, /退回/);
});

test('实盘低于预留可以记录草稿但禁止提交，库存不会取零掩盖差异', () => {
  const draft = act(createWarehouseState(), 'count_edit', { actualQty: 19 });
  assert.equal(count(draft).actualQty, 19); assert.equal(lot(draft).qualified, 200);
  assert.throws(() => act(draft, 'count_submit'), /低于预留/);
  const corruptPending = createWarehouseState(); count(corruptPending).status = 'pending_review'; count(corruptPending).actualQty = 0;
  assert.throws(() => act(corruptPending, 'count_approve'), /低于预留/);
});

test('零差异复核保留结果但不能再次调整；非合格盘点仅影响对应状态', () => {
  const equal = act(act(act(createWarehouseState(), 'count_edit', { actualQty: 200 }), 'count_submit'), 'count_approve');
  assert.equal(equal.movements.at(-1).quantity, 0); assert.equal(lot(equal).qualified, 200);
  assert.throws(() => act(equal, 'count_approve'), /不能重复调整/);
  const created = act(createWarehouseState(), 'count_create', { bucket: 'inspection', actualQty: 0 });
  const countId = created.counts.at(-1).id;
  assert.equal(created.counts.at(-1).bookQty, 10);
  const adjusted = act(act(created, 'count_submit', { countId }), 'count_approve', { countId });
  assert.equal(lot(adjusted).inspection, 0); assert.equal(lot(adjusted).qualified, 200); assert.equal(lot(adjusted).reserved, 20);
  assert.equal(adjusted.movements.at(-1).quantity, -10);
});

test('小数数量保持三位精度，拒绝 NaN、无穷、负数、零发料和超精度值', () => {
  for (const value of [NaN, Infinity, -1, 0, 1.0001, 1e-10, 1e-20, Number.MAX_SAFE_INTEGER]) assert.throws(() => act(createWarehouseState(), 'issue', { quantity: value }), /有效数量/);
  assert.throws(() => act(createWarehouseState(), 'count_create', { actualQty: 1e-10 }), /有效数量/);
  const state = act(createWarehouseState(), 'issue', { quantity: 0.125 });
  assert.equal(lot(state).qualified, 199.875); assert.equal(state.dispatches[0].issuedQty, 60.125);
  const signed = act(state, 'sign', { issueId: state.issues.at(-1).id, actualQty: 0.125 });
  const requested = act(signed, 'return_create', { issueId: signed.issues.at(-1).id, quantity: 0.125 });
  const received = act(requested, 'return_receive', { returnId: requested.returns.at(-1).id, actualQty: 0.125, result: 'qualified', reviewed: true });
  assert.equal(lot(received).qualified, 200);
});

test('状态版本阻止过期和重复请求，失败不修改原对象', () => {
  const state = freeze(createWarehouseState()); const next = act(state, 'issue');
  assert.equal(next.version, state.version + 1);
  assert.throws(() => act(next, 'issue', {}, state.version), /数据已变化/);
  assert.throws(() => act(state, 'issue', {}, NaN), /数据已变化/);
  assert.throws(() => act(state, 'issue', { quantity: 999 })); assert.equal(lot(state).qualified, 200);
});

test('未知操作、无效引用、质量状态、盘点状态、操作人和时间均拒绝', () => {
  const state = createWarehouseState();
  assert.throws(() => act(state, 'unsupported'), /不受支持/);
  assert.throws(() => act(state, 'issue', { lotId: 'missing' }), /已不存在/);
  assert.throws(() => act(state, 'return_create', { result: 'qualified_fake' }), /质量状态/);
  assert.throws(() => act(state, 'return_receive', { result: 'qualified_fake' }), /质量状态/);
  assert.throws(() => act(state, 'count_create', { bucket: 'reserved' }), /盘点库存状态/);
  assert.throws(() => act(state, 'issue', { actor: '未知用户' }), /演示操作人/);
  assert.throws(() => applyWarehouseAction(state, state.version, input('issue'), 'invalid'), /时间无效/);
});

test('说明与依据必填且有长度限制，输入去空格且不接纳伪造状态字段', () => {
  const state = createWarehouseState();
  for (const kind of ['issue', 'sign', 'return_create', 'return_receive', 'return_discrepancy', 'return_resubmit', 'count_create', 'count_edit', 'count_submit', 'count_approve', 'count_reject']) {
    assert.throws(() => act(state, kind, { note: ' ' }), /请填写操作说明/);
    assert.throws(() => act(state, kind, { note: '长'.repeat(2001) }), /不能超过/);
  }
  for (const kind of ['return_create', 'return_receive', 'count_create', 'count_edit']) assert.throws(() => act(state, kind, { evidence: '' }), /依据/);
  const clean = act(state, 'issue', { note: '  已核对批次  ', actor: ' 演示仓管员 ', status: 'signed', qualified: 999, signedQty: 999 });
  assert.equal(clean.issues.at(-1).note, '已核对批次'); assert.equal(clean.issues.at(-1).status, 'pending_signature'); assert.equal(clean.issues.at(-1).signedQty, 0);
  assert.equal(lot(clean).qualified, 180);
});

test('退料和盘点动作在错误阶段被拒绝', () => {
  const state = createWarehouseState();
  assert.throws(() => act(state, 'return_resubmit'), /待核对/);
  assert.throws(() => act(state, 'count_approve'), /待复核/);
  assert.throws(() => act(state, 'count_reject'), /待复核/);
  const pending = act(state, 'count_submit');
  assert.throws(() => act(pending, 'count_submit'), /草稿或退回/);
  assert.throws(() => act(pending, 'count_reject', { actor }), /填报人相同/);
});

test('种子和全套动作保持独立演示标识，多个创建动作生成唯一记录和单据', () => {
  let state = createWarehouseState();
  state = act(state, 'issue', { quantity: 1 }); state = act(state, 'issue', { quantity: 1 });
  state = act(state, 'return_create', { quantity: 1 }); state = act(state, 'count_create');
  for (const collection of ['lots', 'issues', 'returns', 'counts', 'records', 'movements']) {
    assert.equal(new Set(state[collection].map((item) => item.id)).size, state[collection].length);
    for (const item of state[collection]) assert.match(item.id, /^demo-/);
  }
  for (const collection of ['issues', 'returns', 'counts']) for (const item of state[collection]) assert.match(item.code, /^DEMO-/);
});
