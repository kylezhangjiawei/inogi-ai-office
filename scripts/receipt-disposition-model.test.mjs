import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

const source = readFileSync(new URL('../src/app/procurement/receiptDispositionPreviewModel.ts', import.meta.url), 'utf8');
const code = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;
const forbidSideEffect = () => { throw new Error('演示模型不得访问接口或持久化存储'); };
const forbiddenStorage = new Proxy({}, { get: forbidSideEffect, set: forbidSideEffect });
const model = {};
new Function('exports', 'crypto', 'fetch', 'localStorage', 'sessionStorage', 'indexedDB', code)(
  model, { randomUUID }, forbidSideEffect, forbiddenStorage, forbiddenStorage, forbiddenStorage,
);
const { createDispositionPreviewState, dispositionLimits, applyDisposition } = model;
const now = '2026-09-10T01:02:03.000Z';
const input = (kind, patch = {}) => ({
  kind, quantity: 1, date: '2026-09-10', reason: '演示处理原因',
  warehouse: '演示仓库', location: 'DEMO-LOC-01', documentNo: 'DEMO-DOC-01', owner: '演示负责人',
  returnMethod: 'return', expectedDate: '', note: '', ...patch,
});
const save = (state, index, kind, patch = {}, time = now) => {
  const receipt = state.receipts[index];
  return applyDisposition(state, receipt.id, receipt.version, input(kind, patch), time);
};
const classification = (receipt) => [receipt.qualifiedQty, receipt.defectiveQty, receipt.pendingJudgmentQty];
function freeze(value) {
  Object.freeze(value);
  for (const nested of Object.values(value)) if (nested && typeof nested === 'object' && !Object.isFrozen(nested)) freeze(nested);
  return value;
}

test('三条演示数据及期初历史一致，各次初始化相互独立', () => {
  const state = createDispositionPreviewState();
  assert.deepEqual(state.receipts.map((r) => [r.receivedQty, ...classification(r), r.inboundQty, r.isolatedQty, r.returnPlannedQty, r.orderedQty]), [
    [60, 56, 4, 0, 36, 0, 0, 80], [40, 0, 0, 0, 0, 0, 0, 100], [100, 90, 6, 4, 90, 6, 2, 120],
  ]);
  for (const row of state.receipts) {
    assert.match(row.orderNo, /^DEMO-/); assert.match(row.materialCode, /^DEMO-/); assert.match(row.supplierName, /演示/);
    assert.equal(row.originalReceivedQty, row.receivedQty);
  }
  const returnRecord = state.records.find((record) => record.kind === 'return');
  assert.equal(returnRecord.receiptId, state.receipts[2].id);
  assert.equal(returnRecord.quantity, 2); assert.equal(returnRecord.beforeQty, 0); assert.equal(returnRecord.afterQty, 2);
  assert.match(state.records.map((record) => record.note).join(' '), /演示期初/);
  state.receipts[0].receivedQty = 999; state.records[0].reason = '修改';
  const other = createDispositionPreviewState();
  assert.equal(other.receipts[0].receivedQty, 60); assert.notEqual(other.records[0].reason, '修改');
});

test('操作上限分别由已检量、未入库合格、未隔离不良及未安排隔离量确定', () => {
  const state = createDispositionPreviewState();
  assert.deepEqual(state.receipts.map(dispositionLimits), [
    { correctionMin: 60, correctionMax: 80, inbound: 20, isolation: 4, return: 0 },
    { correctionMin: 0, correctionMax: 100, inbound: 0, isolation: 0, return: 0 },
    { correctionMin: 100, correctionMax: 120, inbound: 0, isolation: 0, return: 4 },
  ]);
});

test('纠错是调整总实收，保留原始实收及检验分类，记录精确前后数量', () => {
  const original = createDispositionPreviewState();
  const first = save(original, 1, 'correction', { quantity: 38.125 });
  assert.equal(first.receipts[1].receivedQty, 38.125); assert.equal(first.receipts[1].originalReceivedQty, 40);
  assert.deepEqual(classification(first.receipts[1]), classification(original.receipts[1]));
  assert.equal(first.records[0].beforeQty, 40); assert.equal(first.records[0].afterQty, 38.125);
  const second = save(first, 1, 'correction', { quantity: 100 });
  assert.equal(second.receipts[1].receivedQty, 100); assert.equal(second.receipts[1].originalReceivedQty, 40);
  assert.equal(second.records[0].beforeQty, 38.125); assert.equal(second.records[0].afterQty, 100);
  assert.equal(second.records[1].afterQty, 38.125);
});

test('纠错不能低于全部已检量、超过演示订单量、归零或保存相同量', () => {
  const state = createDispositionPreviewState();
  assert.throws(() => save(state, 0, 'correction', { quantity: 59.999 }), /60 至 80/);
  assert.throws(() => save(state, 0, 'correction', { quantity: 80.001 }), /60 至 80/);
  assert.throws(() => save(state, 2, 'correction', { quantity: 99.999 }), /100 至 120/);
  assert.throws(() => save(state, 1, 'correction', { quantity: 0 }), /大于 0/);
  assert.throws(() => save(state, 1, 'correction', { quantity: 40 }), /相同/);
  const raised = save(state, 0, 'correction', { quantity: 80 });
  assert.equal(save(raised, 0, 'correction', { quantity: 60 }).receipts[0].receivedQty, 60);
  assert.equal(save(state, 1, 'correction', { quantity: 0.001 }).receipts[1].receivedQty, 0.001);
});

test('合格入库只增加入库累计，精确消耗可用上限', () => {
  const state = createDispositionPreviewState();
  assert.throws(() => save(state, 0, 'inbound', { quantity: 20.001 }), /待入库合格量 20/);
  const saved = save(state, 0, 'inbound', { quantity: 20 });
  assert.equal(saved.receipts[0].inboundQty, 56); assert.equal(dispositionLimits(saved.receipts[0]).inbound, 0);
  assert.deepEqual(classification(saved.receipts[0]), classification(state.receipts[0]));
  assert.equal(saved.receipts[0].receivedQty, state.receipts[0].receivedQty);
  assert.deepEqual([saved.records[0].beforeQty, saved.records[0].afterQty], [36, 56]);
  assert.throws(() => save(saved, 0, 'inbound', { quantity: 0.001 }), /待入库合格量 0/);
});

test('先隔离明确不良才能安排退换，待判定不计入可处理量', () => {
  const state = createDispositionPreviewState();
  assert.throws(() => save(state, 0, 'return'), /请先登记隔离/);
  assert.throws(() => save(state, 0, 'isolation', { quantity: 4.001 }), /未隔离不良量 4/);
  const isolated = save(state, 0, 'isolation', { quantity: 3 });
  assert.equal(isolated.receipts[0].isolatedQty, 3); assert.equal(dispositionLimits(isolated.receipts[0]).return, 3);
  assert.deepEqual(classification(isolated.receipts[0]), classification(state.receipts[0]));
  assert.throws(() => save(isolated, 0, 'return', { quantity: 3.001 }), /未安排的不良量 3/);
  const arranged = save(isolated, 0, 'return', { quantity: 3 });
  assert.equal(arranged.receipts[0].returnPlannedQty, 3); assert.equal(arranged.receipts[0].isolatedQty, 3);
  assert.equal(dispositionLimits(arranged.receipts[0]).return, 0);
  assert.equal(dispositionLimits(state.receipts[2]).return, 4);
  assert.throws(() => save(state, 2, 'return', { quantity: 4.001 }), /未安排的不良量 4/);
  assert.throws(() => save(state, 2, 'isolation'), /未隔离不良量 0/);
});

test('退货或换货补货都只登记安排，不产生收货、合格、入库或已退回', () => {
  for (const returnMethod of ['return', 'replacement']) {
    const state = createDispositionPreviewState();
    const saved = save(state, 2, 'return', { quantity: 4, returnMethod, expectedDate: '2026-09-20' });
    assert.deepEqual(saved.receipts[2], { ...state.receipts[2], returnPlannedQty: 6, version: state.receipts[2].version + 1 });
    assert.deepEqual([saved.records[0].beforeQty, saved.records[0].afterQty], [2, 6]);
    assert.throws(() => save(saved, 2, 'return'), /未安排的不良量 0/);
  }
});

test('三位小数按千分位累计，避免浮点误差错挡准确上限', () => {
  const state = createDispositionPreviewState();
  Object.assign(state.receipts[0], { qualifiedQty: 0.3, inboundQty: 0.1, defectiveQty: 0.3, isolatedQty: 0.1, returnPlannedQty: 0 });
  assert.equal(dispositionLimits(state.receipts[0]).inbound, 0.2);
  const inbound = save(state, 0, 'inbound', { quantity: 0.2 });
  assert.equal(inbound.receipts[0].inboundQty, 0.3); assert.equal(inbound.records[0].afterQty, 0.3);
  const isolated = save(inbound, 0, 'isolation', { quantity: 0.2 });
  assert.equal(isolated.receipts[0].isolatedQty, 0.3);
  const arranged = save(isolated, 0, 'return', { quantity: 0.1 });
  assert.equal(dispositionLimits(arranged.receipts[0]).return, 0.2);
  assert.equal(save(arranged, 0, 'return', { quantity: 0.2 }).receipts[0].returnPlannedQty, 0.3);
  assert.equal(save(createDispositionPreviewState(), 1, 'correction', { quantity: 1.001 }).receipts[1].receivedQty, 1.001);
});

test('所有操作拒绝非正数、非有限数、超过三位小数和不安全数量', () => {
  const state = createDispositionPreviewState();
  for (const kind of ['correction', 'inbound', 'isolation', 'return']) {
    for (const quantity of [0, -1, NaN, Infinity, 0.0001, 1.0001, Number.MAX_VALUE]) {
      assert.throws(() => save(state, 0, kind, { quantity }), /数量必须大于 0，且最多保留三位小数/);
    }
  }
});

test('各模式的必填业务字段校验完整且错误不修改状态', () => {
  const state = freeze(createDispositionPreviewState());
  for (const [kind, fields, index] of [
    ['correction', ['reason'], 1],
    ['inbound', ['reason', 'warehouse', 'location', 'documentNo'], 0],
    ['isolation', ['reason', 'warehouse', 'location', 'owner'], 0],
    ['return', ['reason', 'documentNo', 'owner'], 2],
  ]) {
    for (const field of fields) assert.throws(() => save(state, index, kind, { [field]: '  ' }), /请填写/);
  }
  assert.throws(() => save(state, 2, 'return', { returnMethod: 'invalid' }), /请选择退货或换货补货/);
  assert.throws(() => save(state, 2, 'invalid'), /有效的演示处理类型/);
});

test('操作日期必填且真实有效，以北京时间界定今天', () => {
  const state = createDispositionPreviewState();
  for (const kind of ['correction', 'inbound', 'isolation', 'return']) {
    for (const date of ['', '2026-02-30', '2026-13-01', '2026-9-10', 'not-a-date']) {
      assert.throws(() => save(state, kind === 'return' ? 2 : 0, kind, { date }), /有效的操作日期/);
    }
    assert.throws(() => save(state, kind === 'return' ? 2 : 0, kind, { date: '2026-09-07' }), /不能早于本批收货日期/);
    assert.throws(() => save(state, kind === 'return' ? 2 : 0, kind, { date: '2026-09-11' }), /不能晚于北京今天/);
  }
  const beforeBeijingMidnight = '2026-09-09T15:59:59Z';
  const beijingMidnight = '2026-09-09T16:00:00Z';
  assert.throws(() => save(state, 1, 'correction', { quantity: 39 }, beforeBeijingMidnight), /北京今天/);
  assert.equal(save(state, 1, 'correction', { quantity: 39 }, beijingMidnight).receipts[1].receivedQty, 39);
  assert.throws(() => save(state, 1, 'correction', { quantity: 39 }, 'invalid'), /当前演示时间无效/);
});

test('原因、备注、单号及负责人遵守前端字段长度上限', () => {
  const state = createDispositionPreviewState();
  for (const [kind, index] of [['correction', 1], ['inbound', 0], ['isolation', 0], ['return', 2]]) {
    for (const field of ['reason', 'note']) assert.throws(() => save(state, index, kind, { [field]: '字'.repeat(1001) }), /不能超过 1000 个字符/);
    assert.equal(save(state, index, kind, { reason: '字'.repeat(1000), note: '字'.repeat(1000) }).records[0].reason.length, 1000);
  }
  for (const [kind, index] of [['inbound', 0], ['return', 2]]) {
    assert.throws(() => save(state, index, kind, { documentNo: 'A'.repeat(121) }), /不能超过 120 个字符/);
    assert.equal(save(state, index, kind, { documentNo: 'A'.repeat(120) }).records[0].documentNo.length, 120);
  }
  for (const [kind, index] of [['isolation', 0], ['return', 2]]) {
    assert.throws(() => save(state, index, kind, { owner: '字'.repeat(81) }), /不能超过 80 个字符/);
    assert.equal(save(state, index, kind, { owner: '字'.repeat(80) }).records[0].owner.length, 80);
  }
});

test('操作切换后不相关草稿字段不会串入保存记录', () => {
  const state = createDispositionPreviewState();
  const patch = { returnMethod: 'replacement', expectedDate: '2026-09-20' };
  const correction = save(state, 1, 'correction', patch).records[0];
  for (const field of ['warehouse', 'location', 'documentNo', 'owner', 'expectedDate']) assert.equal(correction[field], '');
  assert.equal(correction.returnMethod, 'return');
  const inbound = save(state, 0, 'inbound', patch).records[0];
  assert.equal(inbound.owner, ''); assert.equal(inbound.expectedDate, ''); assert.equal(inbound.returnMethod, 'return');
  const isolation = save(state, 0, 'isolation', patch).records[0];
  assert.equal(isolation.documentNo, ''); assert.equal(isolation.expectedDate, ''); assert.equal(isolation.returnMethod, 'return');
  const replacement = save(state, 2, 'return', patch).records[0];
  assert.equal(replacement.warehouse, ''); assert.equal(replacement.location, '');
  assert.equal(replacement.expectedDate, patch.expectedDate); assert.equal(replacement.returnMethod, 'replacement');
  assert.equal(save(state, 2, 'return', { expectedDate: '2026-09-20' }).records[0].expectedDate, '');
});

test('换货补货需要有效预计日期且不能早于操作日期，允许将来计划', () => {
  const state = createDispositionPreviewState();
  for (const expectedDate of ['', '2026-02-30']) assert.throws(() => save(state, 2, 'return', { returnMethod: 'replacement', expectedDate }), /有效的预计补货日期/);
  assert.throws(() => save(state, 2, 'return', { returnMethod: 'replacement', expectedDate: '2026-09-09' }), /不能早于操作日期/);
  assert.equal(save(state, 2, 'return', { returnMethod: 'replacement', expectedDate: '2026-09-10' }).receipts[2].returnPlannedQty, 3);
  assert.equal(save(state, 2, 'return', { returnMethod: 'replacement', expectedDate: '2027-01-01' }).records[0].expectedDate, '2027-01-01');
});

test('版本冲突及批次不存在阻止旧草稿保存', () => {
  const state = createDispositionPreviewState();
  const receipt = state.receipts[0];
  const saved = save(state, 0, 'inbound');
  assert.equal(saved.receipts[0].version, receipt.version + 1);
  assert.throws(() => applyDisposition(saved, receipt.id, receipt.version, input('inbound'), now), /版本已变化.*重新打开/);
  assert.throws(() => applyDisposition(state, 'missing-receipt', 0, input('inbound'), now), /未找到演示收货批次/);
  assert.equal(saved.receipts[0].inboundQty, 37); assert.equal(saved.records.length, state.records.length + 1);
});

test('保存返回新状态并保留原对象和历史；记录标识唯一、字段去空格且时间可验证', () => {
  const state = freeze(createDispositionPreviewState());
  const draft = freeze(input('inbound', { reason: '  入库原因  ', warehouse: ' 演示仓 ', location: ' A ', documentNo: ' DEMO-1 ', owner: ' 演示人员 ', note: ' 备注 ' }));
  const saved = applyDisposition(state, state.receipts[0].id, state.receipts[0].version, draft, now);
  assert.notEqual(saved, state); assert.notEqual(saved.receipts, state.receipts); assert.notEqual(saved.records, state.records);
  assert.notEqual(saved.receipts[0], state.receipts[0]); assert.equal(state.receipts[0].inboundQty, 36);
  assert.deepEqual(saved.records.slice(1), state.records); assert.equal(state.records.length, 2);
  assert.equal(saved.records[0].reason, '入库原因'); assert.equal(saved.records[0].warehouse, '演示仓');
  assert.equal(saved.records[0].note, '备注'); assert.equal(saved.records[0].createdAt, now);
  const next = save(saved, 0, 'inbound');
  assert.notEqual(next.records[0].id, saved.records[0].id);
  assert.match(next.records[0].id, /^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[\da-f]{4}-[\da-f]{12}$/i);
});

test('演示模型无运行时依赖，不调用接口或浏览器持久化存储', () => {
  assert.doesNotMatch(code, /\brequire\s*\(/);
  assert.doesNotMatch(source, /\b(?:fetch|XMLHttpRequest|WebSocket|localStorage|sessionStorage|indexedDB)\b/);
  let state = createDispositionPreviewState();
  state = save(state, 1, 'correction', { quantity: 39 });
  state = save(state, 0, 'inbound'); state = save(state, 0, 'isolation'); state = save(state, 0, 'return');
  assert.equal(state.records.length, 6);
});
