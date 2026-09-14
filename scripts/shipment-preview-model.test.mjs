import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

const source = readFileSync(new URL('../src/app/procurement/shipments/shipmentPreviewModel.ts', import.meta.url), 'utf8');
const code = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
const forbidden = () => { throw new Error('出货演示不能访问接口或持久化'); };
const storage = new Proxy({}, { get: forbidden, set: forbidden });
const model = {};
new Function('exports', 'fetch', 'localStorage', 'sessionStorage', 'indexedDB', code)(model, forbidden, storage, storage, storage);
const { createShipmentState, applyShipmentAction, validateShipmentAction, availableToShip, shipmentMonthSummary, shipmentSeedIds: ids } = model;
const now = '2026-09-11T03:00:00.000Z';
const actor = '演示仓管员';
const rec = (state, id = ids.draftShipment) => state.records.find((record) => record.id === id);
const summary = (state, month = '2026-09') => shipmentMonthSummary(state, month);
const fields = (state, id = ids.draftShipment) => {
  const { documentNo, actualDate, customer, orderNo, batchId, quantity, handler, note, serialNumbers } = rec(state, id);
  return { documentNo, actualDate, customer, orderNo, batchId, quantity, handler, note, serialNumbers };
};
const act = (state, action, version = state.version, time = now) => applyShipmentAction(state, version, { actor, ...action }, time);
const create = (state, patch = {}) => act(state, { kind: 'create', ...fields(state), documentNo: 'SHIP-NEW-01', ...patch });
const edit = (state, patch = {}) => act(state, { kind: 'edit', recordId: ids.draftShipment, reason: '核对原出库凭据', ...fields(state), ...patch });
const freeze = (value) => { Object.freeze(value); for (const item of Object.values(value)) if (item && typeof item === 'object' && !Object.isFrozen(item)) freeze(item); return value; };

test('种子将完工、终检、质量放行、实际出货与 SN 完整度分开', () => {
  const state = createShipmentState();
  assert.deepEqual(summary(state), { target: 1000, completed: 216, shipped: 180, remaining: 820, achievement: 0.18, count: 2 });
  assert.equal(availableToShip(state, ids.firstBatch), 0);
  assert.equal(availableToShip(state, ids.secondBatch), 20);
  assert.equal(availableToShip(state, ids.unreleasedBatch), 0);
  assert.equal(state.batches[1].completedQty, 116);
  assert.equal(state.batches[1].inspectionPassedQty, 116);
  assert.equal(state.batches[1].releasedQty, 100);
  assert.equal(rec(state, ids.secondShipment).serialNumbers.length, 0);
  state.records[0].serialNumbers.push('mutable'); state.batches[0].completedQty = 900; state.months['2026-09'].target = 1;
  assert.equal(createShipmentState().records[0].serialNumbers.length, 0);
  assert.equal(createShipmentState().batches[0].completedQty, 100);
  assert.equal(createShipmentState().months['2026-09'].target, 1000);
});

test('A18：确认余下 20 台仅使出货 180→200，完工仍为 216', () => {
  const original = freeze(createShipmentState());
  const next = act(original, { kind: 'confirm', recordId: ids.draftShipment });
  assert.deepEqual(summary(next), { target: 1000, completed: 216, shipped: 200, remaining: 800, achievement: 0.2, count: 3 });
  assert.equal(availableToShip(next, ids.secondBatch), 0);
  assert.deepEqual(next.batches, original.batches);
  assert.equal(rec(next).confirmedAt, now);
  assert.equal(rec(original).status, 'draft');
  assert.equal(next.history.at(-1).before.status, 'draft');
  assert.equal(next.history.at(-1).after.status, 'confirmed');
  assert.equal(next.version, original.version + 1);
});

test('登记和修改草稿不计出货、不占放行量，确认时再次检查剩余数量', () => {
  const original = createShipmentState();
  const added = create(original, { quantity: 15 }); const addedId = added.records.at(-1).id;
  assert.equal(summary(added).shipped, 180); assert.equal(availableToShip(added, ids.secondBatch), 20);
  const changed = edit(added, { quantity: 10 });
  assert.equal(summary(changed).shipped, 180); assert.equal(availableToShip(changed, ids.secondBatch), 20);
  assert.equal(changed.history.at(-1).before.quantity, 20); assert.equal(changed.history.at(-1).after.quantity, 10);
  const shipped = act(changed, { kind: 'confirm', recordId: addedId });
  assert.equal(availableToShip(shipped, ids.secondBatch), 5);
  assert.throws(() => act(shipped, { kind: 'confirm', recordId: ids.draftShipment }), /剩余授权放行/);
});

test('按实际出货日期归属月份，登记与确认月份不代替实际日期', () => {
  const state = createShipmentState();
  state.batches[1].releasedOn = '2026-08-30';
  const draft = edit(state, { actualDate: '2026-08-31' });
  assert.equal(summary(draft, '2026-08').shipped, 0);
  const shipped = act(draft, { kind: 'confirm', recordId: ids.draftShipment });
  assert.equal(summary(shipped).shipped, 180);
  assert.equal(summary(shipped, '2026-08').shipped, 20);
  const reversed = act(shipped, { kind: 'reverse', recordId: ids.draftShipment, reason: '凭据重复登记', createReplacement: false });
  assert.equal(summary(reversed, '2026-08').shipped, 0);
  assert.equal(summary(reversed).shipped, 180);
  assert.deepEqual(reversed.months, state.months);
});

test('缺失和零目标展示无达成率，超目标的剩余量为零', () => {
  const state = createShipmentState();
  state.months['2026-09'].target = 0;
  assert.equal(summary(state).achievement, null); assert.equal(summary(state).remaining, 0);
  assert.deepEqual(summary(state, '2026-10'), { target: null, completed: null, shipped: 0, remaining: null, achievement: null, count: 0 });
  state.months['2026-09'].target = 100;
  assert.equal(summary(state).remaining, 0); assert.equal(summary(state).achievement, 1.8);
  assert.throws(() => summary(state, '2026-13'), /有效月份/);
});

test('终检合格但未获质量授权放行可以登记，不能确认实际出库', () => {
  const state = create(createShipmentState(), { batchId: ids.unreleasedBatch, quantity: 20 });
  const id = state.records.at(-1).id;
  assert.equal(rec(state, id).status, 'draft');
  assert.throws(() => act(state, { kind: 'confirm', recordId: id }), /质量授权放行/);
  assert.equal(summary(state).shipped, 180);
});

test('放行依据、放行数量和放行日期分别校验，终检数量不能冒充额度', () => {
  for (const patch of [{ releaseEvidence: '' }, { releasedOn: '' }, { releasedQty: 0 }]) {
    const state = createShipmentState(); Object.assign(state.batches[1], patch);
    assert.throws(() => act(state, { kind: 'confirm', recordId: ids.draftShipment }), /质量授权放行/);
  }
  const over = edit(createShipmentState(), { quantity: 21 });
  assert.throws(() => act(over, { kind: 'confirm', recordId: ids.draftShipment }), /剩余授权放行/);
  const invalid = createShipmentState(); invalid.batches[1].releasedQty = 117;
  assert.throws(() => act(invalid, { kind: 'confirm', recordId: ids.draftShipment }), /数量不一致/);
  const early = edit(createShipmentState(), { actualDate: '2026-09-06' });
  assert.throws(() => act(early, { kind: 'confirm', recordId: ids.draftShipment }), /早于质量放行日期/);
  const malformed = createShipmentState(); malformed.batches[1].releasedOn = '2026-02-30';
  assert.throws(() => act(malformed, { kind: 'confirm', recordId: ids.draftShipment }), /质量放行日期.*有效/);
});

test('重复确认、重复冲销、已确认核心字段编辑和过期提交均被阻止', () => {
  const original = createShipmentState(); const confirmed = act(original, { kind: 'confirm', recordId: ids.draftShipment });
  assert.throws(() => act(confirmed, { kind: 'confirm', recordId: ids.draftShipment }), /不能重复确认/);
  assert.throws(() => edit(confirmed, { quantity: 10 }), /只有待确认/);
  assert.throws(() => act(confirmed, { kind: 'reverse', recordId: ids.draftShipment, reason: '重复', createReplacement: false }, original.version), /数据已变化/);
  const reversed = act(confirmed, { kind: 'reverse', recordId: ids.draftShipment, reason: '重复', createReplacement: false });
  assert.throws(() => act(reversed, { kind: 'reverse', recordId: ids.draftShipment, reason: '重复', createReplacement: false }), /不能重复冲销/);
  assert.throws(() => act(reversed, { kind: 'confirm', recordId: ids.draftShipment }), /不能重复确认/);
  assert.throws(() => act(original, { kind: 'confirm', recordId: ids.draftShipment }, NaN), /数据已变化/);
});

test('冲销不覆盖原出货数值，历史保留原因，统计和放行余量按有效记录重算', () => {
  const original = freeze(createShipmentState());
  const state = act(original, { kind: 'reverse', recordId: ids.secondShipment, reason: '  出库凭据重复，撤销本笔  ', createReplacement: false });
  const reversed = rec(state, ids.secondShipment);
  assert.equal(reversed.status, 'reversed'); assert.equal(reversed.quantity, 80); assert.equal(reversed.confirmedAt, rec(original, ids.secondShipment).confirmedAt);
  assert.equal(reversed.reversedAt, now); assert.equal(summary(state).shipped, 100); assert.equal(summary(state).completed, 216);
  assert.equal(availableToShip(state, ids.secondBatch), 100);
  assert.equal(state.history.at(-1).before.status, 'confirmed'); assert.equal(state.history.at(-1).reason, '出库凭据重复，撤销本笔');
  assert.deepEqual(state.batches, original.batches);
  assert.equal(rec(original, ids.secondShipment).status, 'confirmed');
});

test('更正必须先冲销并创建关联新草稿，不能静默再次出货', () => {
  const source = createShipmentState();
  const updated = act(source, { kind: 'sn', recordId: ids.secondShipment, reason: '补录装箱清单', serialNumbers: ['SN-080-1'] });
  const state = act(updated, { kind: 'reverse', recordId: ids.secondShipment, reason: '实际数量应为 70 台', createReplacement: true });
  const replacement = state.records.at(-1);
  assert.equal(replacement.replacementFor, ids.secondShipment); assert.notEqual(replacement.id, ids.secondShipment);
  assert.notEqual(replacement.documentNo, rec(source, ids.secondShipment).documentNo);
  assert.equal(replacement.status, 'draft'); assert.equal(replacement.confirmedAt, null); assert.equal(replacement.reversedAt, null);
  assert.deepEqual(replacement.serialNumbers, ['SN-080-1']); assert.equal(summary(state).shipped, 100);
  const corrected = act(state, { kind: 'edit', recordId: replacement.id, ...fields(state, replacement.id), quantity: 70, reason: '依据实际出库凭据核正为 70 台' });
  const confirmed = act(corrected, { kind: 'confirm', recordId: replacement.id });
  assert.equal(summary(confirmed).shipped, 170); assert.equal(summary(confirmed).completed, 216);
  assert.equal(rec(confirmed, ids.secondShipment).quantity, 80); assert.equal(rec(confirmed, ids.secondShipment).status, 'reversed');
  assert.equal(rec(confirmed, replacement.id).replacementFor, ids.secondShipment);
});

test('更正单号即使发生历史冲突也保持唯一，已冲销单号不得重新登记', () => {
  let state = create(createShipmentState(), { documentNo: 'SHIP-0908-01-R1', quantity: 1 });
  state = act(state, { kind: 'reverse', recordId: ids.secondShipment, reason: '凭据核对', createReplacement: true });
  assert.equal(state.records.at(-1).documentNo, 'SHIP-0908-01-R2');
  assert.throws(() => create(state, { documentNo: ' ship-0908-01 ' }), /单号已存在/);
  assert.throws(() => create(state, { documentNo: 'SHIP-0906-01' }), /单号已存在/);
});

test('缺失或部分 SN 不阻断出库，已出库补录 SN 仅改变关联与历史', () => {
  const first = edit(createShipmentState(), { serialNumbers: ['SN-020-1', 'SN-020-2'] });
  const confirmed = act(first, { kind: 'confirm', recordId: ids.draftShipment });
  assert.equal(rec(confirmed).serialNumbers.length, 2); assert.equal(rec(confirmed).quantity, 20);
  const completed = act(confirmed, { kind: 'sn', recordId: ids.draftShipment, reason: '补充装箱单中的 SN', serialNumbers: ['SN-020-1', 'SN-020-2', 'SN-020-3'] });
  assert.deepEqual(summary(completed), summary(confirmed)); assert.deepEqual(completed.batches, confirmed.batches);
  assert.equal(rec(completed).quantity, 20); assert.equal(rec(completed).status, 'confirmed');
  assert.equal(rec(completed).confirmedAt, rec(confirmed).confirmedAt);
  assert.equal(completed.history.at(-1).before.serialNumbers.length, 2); assert.equal(completed.history.at(-1).after.serialNumbers.length, 3);
  assert.throws(() => act(completed, { kind: 'sn', recordId: ids.draftShipment, reason: '无更改', serialNumbers: rec(completed).serialNumbers }), /没有变化/);
});

test('SN 清单拒绝超数量、空条目及大小写 / 空白重复', () => {
  const state = createShipmentState();
  assert.throws(() => edit(state, { quantity: 1, serialNumbers: ['SN-1', 'SN-2'] }), /不能超过出货数量/);
  assert.throws(() => edit(state, { serialNumbers: ['SN-1', ' sn-1 '] }), /SN 重复/);
  assert.throws(() => edit(state, { serialNumbers: ['  '] }), /请填写SN/);
  assert.throws(() => edit(state, { serialNumbers: 'SN-1' }), /列表格式/);
  assert.throws(() => edit(state, { serialNumbers: ['x'.repeat(129)] }), /不能超过 128/);
});

test('SN 不能跨有效草稿 / 已出库记录复用，冲销后可以由关联更正单使用', () => {
  const state = edit(createShipmentState(), { serialNumbers: ['SN-A'] });
  assert.throws(() => create(state, { serialNumbers: ['sn-a'] }), /其他有效登记/);
  assert.throws(() => act(state, { kind: 'sn', recordId: ids.secondShipment, reason: '补录', serialNumbers: ['SN-A'] }), /其他有效登记/);
  assert.throws(() => act(state, { kind: 'sn', recordId: ids.draftShipment, reason: '补录', serialNumbers: [] }), /只有已出库/);
  const confirmed = act(state, { kind: 'confirm', recordId: ids.draftShipment });
  assert.throws(() => create(confirmed, { serialNumbers: ['SN-A'] }), /其他有效登记/);
  const reversed = act(confirmed, { kind: 'reverse', recordId: ids.draftShipment, reason: '关联更正', createReplacement: false });
  assert.doesNotThrow(() => create(reversed, { serialNumbers: ['SN-A'] }));
  assert.throws(() => act(reversed, { kind: 'sn', recordId: ids.draftShipment, reason: '补录', serialNumbers: [] }), /只有已出库/);
});

test('实际日期拒绝不存在日期、未来日期和无效格式', () => {
  const state = createShipmentState();
  for (const actualDate of ['2026-02-29', '2026-02-30', '2026-13-01', '2026-00-01', '2026-09-00', '2026-09-31', '2026-9-01', 'not-a-date']) {
    assert.throws(() => edit(state, { actualDate }), /有效日期/);
  }
  assert.throws(() => edit(state, { actualDate: '2026-09-12' }), /晚于今天/);
  assert.doesNotThrow(() => edit(state, { actualDate: '2024-02-29' }));
  assert.doesNotThrow(() => edit(state, { actualDate: '2026-09-11' }));
  assert.throws(() => act(state, { kind: 'confirm', recordId: ids.draftShipment }, state.version, 'invalid'), /操作时间无效/);
});

test('上海日期跨日后允许当天出货，时区不使用 UTC 前一天误拦截', () => {
  const state = createShipmentState();
  const action = { kind: 'edit', recordId: ids.draftShipment, ...fields(state), actualDate: '2026-09-12', reason: '按实际出货日核正' };
  assert.doesNotThrow(() => act(state, action, state.version, '2026-09-11T16:01:00.000Z'));
  assert.throws(() => act(state, action, state.version, '2026-09-11T15:59:00.000Z'), /晚于今天/);
});

test('必填、边界数量、文本长度和运行时操作类型均受校验', () => {
  const state = createShipmentState();
  for (const amount of [0, -1, 0.5, NaN, Infinity, '20', Number.MAX_SAFE_INTEGER + 1]) assert.throws(() => edit(state, { quantity: amount }), /整数/);
  for (const field of ['documentNo', 'customer', 'orderNo', 'handler', 'batchId']) assert.throws(() => edit(state, { [field]: ' ' }), /请填写/);
  assert.throws(() => edit(state, { documentNo: 'x'.repeat(81) }), /不能超过 80/);
  assert.throws(() => edit(state, { note: 'x'.repeat(2001) }), /不能超过 2000/);
  assert.throws(() => edit(state, { reason: '' }), /修改原因/);
  assert.throws(() => act(state, { kind: 'reverse', recordId: ids.secondShipment, reason: '', createReplacement: false }), /冲销 \/ 更正原因/);
  assert.throws(() => act(state, { kind: 'reverse', recordId: ids.secondShipment, reason: '核对', createReplacement: 'yes' }), /是否生成更正登记/);
  assert.throws(() => act(state, { kind: 'sn', recordId: ids.secondShipment, reason: '', serialNumbers: ['SN-1'] }), /SN 调整原因/);
  assert.throws(() => act(state, { kind: 'confirm', recordId: ids.draftShipment, actor: ' ' }), /操作人/);
  assert.throws(() => act(state, { kind: 'unknown' }), /不支持/);
  assert.throws(() => validateShipmentAction(state, null, now), /不支持/);
  assert.throws(() => act(state, { kind: 'confirm', recordId: 'gone' }), /已不存在/);
  assert.throws(() => edit(state, { batchId: 'gone' }), /有效的生产批次/);
});

test('规范化输入且历史快照、当前记录、调用者输入不互相污染', () => {
  const state = freeze(createShipmentState());
  const serialNumbers = [' SN-1 '];
  const next = create(state, { documentNo: ' SHIP-NEW-01 ', customer: ' 客户甲 ', handler: ' 仓管 A ', note: ' 核对说明 ', serialNumbers });
  assert.equal(next.records.at(-1).documentNo, 'SHIP-NEW-01'); assert.equal(next.records.at(-1).customer, '客户甲');
  assert.equal(next.records.at(-1).handler, '仓管 A'); assert.equal(next.records.at(-1).note, '核对说明');
  serialNumbers.push('outside');
  assert.deepEqual(next.records.at(-1).serialNumbers, ['SN-1']);
  next.records.at(-1).serialNumbers.push('current');
  assert.deepEqual(next.history.at(-1).after.serialNumbers, ['SN-1']);
  next.history[0].after.serialNumbers.push('history');
  assert.equal(state.history[0].after.serialNumbers.length, 0);
  next.months['2026-09'].target = 999; assert.equal(state.months['2026-09'].target, 1000);
});

test('预检不更改状态，失败动作不增加历史、不部分写入或调用外部服务', () => {
  const state = freeze(createShipmentState()); const before = JSON.stringify(state);
  assert.doesNotThrow(() => validateShipmentAction(state, { kind: 'confirm', actor, recordId: ids.draftShipment }, now));
  assert.equal(JSON.stringify(state), before);
  assert.throws(() => act(state, { kind: 'reverse', recordId: ids.draftShipment, reason: '不允许', createReplacement: false }), /只有已出库/);
  assert.throws(() => edit(state, { serialNumbers: ['duplicate', 'duplicate'] }), /SN 重复/);
  assert.equal(JSON.stringify(state), before);
});
