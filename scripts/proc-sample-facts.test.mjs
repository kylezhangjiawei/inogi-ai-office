import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

const source = readFileSync(new URL('../src/app/lib/procSampleFacts.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
}).outputText;
const { getProcSampleFacts } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);

const assigned = {
  roundId: 'round-2', testerUserId: 'rd-1', testerName: '研发甲', assignedByName: '采购乙',
  assignedAt: '2026-09-09T04:00:00.000Z', result: null, note: null, confirmedAt: null, confirmedByName: null,
};
const passed = { ...assigned, result: 'passed', note: '尺寸检查通过', confirmedAt: '2026-09-09T05:00:00.000Z', confirmedByName: '研发甲' };
const task = (status, sampleTest = null, extra = {}) => ({ status, needSample: true, sampleTest, logs: [], ...extra });
const transition = (fromStatus, toStatus, createdAt, text = '样品已到') => ({ fromStatus, toStatus, createdAt, text, at: createdAt?.slice(0, 10) || '2026-09-09' });

test('新协议分派不能替代独立到样登记，只暴露当前有效实际时间', () => {
  for (const arrivedAt of [null, undefined, '2026-02-30T00:00:00Z']) {
    const result = getProcSampleFacts(task('testing', { ...assigned, recordsVersion: 1, arrivedAt }));
    assert.equal(result.state, 'unknown'); assert.equal(result.arrivedAt, null); assert.equal(result.label, '实际到样待登记');
  }
  const sample = { ...assigned, recordsVersion: 1, arrivedAt: '2026-09-09T03:00:00Z' };
  assert.equal(getProcSampleFacts(task('testing', sample)).arrivedAt, sample.arrivedAt);
  for (const status of ['pending_sample', 'inquiring', 'cancelled']) assert.equal(getProcSampleFacts(task(status, sample)).arrivedAt, null);
});

test('询价、准备及直购阶段不会因非待到样或保留旧测试结论而被标为已到样', () => {
  for (const status of ['pending_rd_review', 'pending_confirm', 'pending_inquiry', 'inquiring', 'pending_purchase']) {
    for (const sample of [null, assigned, passed]) {
      const result = getProcSampleFacts(task(status, sample));
      assert.equal(result.state, 'unknown', `${status}/${sample?.result}`);
      assert.equal(result.label, '到样状态待确认');
      assert.equal(result.evidence.at, null);
    }
  }
});

test('待到样优先于旧分派和已通过结论，出样登记不代表已收样', () => {
  for (const sample of [null, assigned, passed]) {
    const result = getProcSampleFacts(task('pending_sample', sample));
    assert.equal(result.state, 'waiting');
    assert.equal(result.evidence.roundId, null);
    assert.equal(result.arrivedAt, null);
  }
});

test('改样后的新一轮等待收样，换供应商询价不沿用旧到样', () => {
  const resample = getProcSampleFacts(task('pending_sample', { ...passed, result: 'failed_resample' }));
  assert.equal(resample.state, 'waiting');
  assert.match(resample.description, /上一轮.*重新送样/);
  assert.equal(getProcSampleFacts(task('inquiring', { ...passed, result: 'failed_requote' })).state, 'unknown');
  for (const result of ['failed_resample', 'failed_requote']) {
    assert.equal(getProcSampleFacts(task('priced', { ...passed, result })).state, 'unknown');
  }
});

test('取消后只展示取消事实，不用历史样品证明当前到样', () => {
  const result = getProcSampleFacts(task('cancelled', passed));
  assert.equal(result.state, 'cancelled');
  assert.equal(result.evidence.roundId, null);
  assert.equal(result.evidence.at, null);
});

test('真实测试分派可作为到样确认依据，但其时间绝不冒充实际到样日期', () => {
  const result = getProcSampleFacts(task('testing', assigned));
  assert.equal(result.state, 'confirmed');
  assert.equal(result.evidence.kind, 'test_assignment');
  assert.equal(result.evidence.at, assigned.assignedAt);
  assert.equal(result.evidence.roundId, assigned.roundId);
  assert.equal(result.arrivedAt, null);
  assert.match(result.description, /分派时间不是实际到样日期/);
});

test('未提交结果却残留旧结论时不作为当前有效分派依据', () => {
  const result = getProcSampleFacts(task('testing', { ...assigned, note: '上一轮尺寸测试通过' }));
  assert.equal(result.state, 'unknown');
  assert.equal(result.evidence.roundId, null);
  assert.equal(getProcSampleFacts(task('testing', { ...assigned, note: '  ' })).state, 'confirmed');
});

test('未提交结果却残留提交人时不作为当前有效分派依据', () => {
  const result = getProcSampleFacts(task('testing', { ...assigned, confirmedByName: '上一轮确认人' }));
  assert.equal(result.state, 'unknown');
  assert.equal(result.evidence.at, null);
  assert.equal(getProcSampleFacts(task('testing', { ...assigned, confirmedByName: '' })).state, 'confirmed');
});

test('仅有测试状态或历史跳过待到样标记时明确待确认', () => {
  assert.equal(getProcSampleFacts(task('testing')).state, 'unknown');
  const result = getProcSampleFacts(task('testing', null, { sampleStatusNeedsReview: true }));
  assert.equal(result.state, 'unknown');
  assert.match(result.description, /历史任务/);
});

test('历史异常状态补做真实分派后可确认依据，不被仍保留的旧状态标记遮蔽', () => {
  const result = getProcSampleFacts(task('testing', assigned, { sampleStatusNeedsReview: true,
    logs: [transition('inquiring', 'testing', '2026-09-08T04:00:00.000Z'), transition('testing', 'testing', assigned.assignedAt)],
  }));
  assert.equal(result.state, 'confirmed');
  assert.equal(result.evidence.roundId, 'round-2');
});

test('通过后的采购阶段依据完整本人结论确认，不靠采购状态自动补到样', () => {
  for (const status of ['priced', 'in_transit', 'partial_arrival', 'completed']) {
    const result = getProcSampleFacts(task(status, passed));
    assert.equal(result.state, 'confirmed');
    assert.equal(result.evidence.kind, 'test_result');
    assert.equal(result.evidence.at, passed.confirmedAt);
    assert.equal(result.arrivedAt, null);
    assert.equal(getProcSampleFacts(task(status)).state, 'unknown');
    assert.equal(getProcSampleFacts(task(status, assigned)).state, 'unknown');
  }
});

test('回退到测试中的旧已通过结论不是新的有效分派', () => {
  assert.equal(getProcSampleFacts(task('testing', passed)).state, 'unknown');
});

test('后续阶段未提供状态历史时不凭旧通过结论确认当前轮，已返回空历史才可判断', () => {
  for (const status of ['priced', 'in_transit', 'partial_arrival', 'completed']) {
    const input = task(status, passed);
    delete input.logs;
    const result = getProcSampleFacts(input);
    assert.equal(result.state, 'unknown');
    assert.match(result.description, /缺少状态流转记录/);
    assert.equal(result.evidence.at, null);
    assert.equal(getProcSampleFacts({ ...input, logs: [] }).state, 'confirmed');
  }
  assert.equal(getProcSampleFacts({ status: 'testing', sampleTest: assigned }).state, 'confirmed');
});

test('退回询价又推进后的旧 passed 记录由结构化回退事实失效', () => {
  const logs = [transition('priced', 'pending_inquiry', '2026-09-09T06:00:00.000Z'), transition('inquiring', 'priced', '2026-09-09T07:00:00.000Z')];
  const result = getProcSampleFacts(task('priced', passed, { logs }));
  assert.equal(result.state, 'unknown');
  assert.match(result.description, /回退或取消/);
});

test('取消重提后旧测试不可复用，旧时间线中重提之前的回退不污染新轮', () => {
  const reset = [transition('priced', 'cancelled', '2026-09-09T06:00:00.000Z'), transition('cancelled', 'pending_confirm', '2026-09-09T07:00:00.000Z')];
  assert.equal(getProcSampleFacts(task('priced', passed, { logs: reset })).state, 'unknown');
  const next = { ...assigned, roundId: 'round-3', assignedAt: '2026-09-09T08:00:00.000Z' };
  assert.equal(getProcSampleFacts(task('testing', next, { logs: reset })).state, 'confirmed');
});

test('缺少精确时间的回退记录不能证明与分派的先后顺序，保守待确认', () => {
  const result = getProcSampleFacts(task('priced', passed, { logs: [transition('priced', 'pending_sample', undefined)] }));
  assert.equal(result.state, 'unknown');
  assert.equal(result.evidence.at, null);
});

test('在途退回已定价不重置已完成样品测试，正常分派与通过转换也不误判回退', () => {
  const logs = [transition('pending_sample', 'testing', assigned.assignedAt), transition('testing', 'priced', passed.confirmedAt), transition('in_transit', 'priced', '2026-09-09T06:00:00.000Z')];
  assert.equal(getProcSampleFacts(task('priced', passed, { logs })).state, 'confirmed');
});

test('日期缺失、只有日期无时刻、测试人或轮次缺失时不能构造确认依据', () => {
  for (const patch of [{ assignedAt: '' }, { assignedAt: 'invalid' }, { assignedAt: '2026-09-09' }, { testerUserId: '' }, { roundId: '' }, { assignedByName: '' }]) {
    assert.equal(getProcSampleFacts(task('testing', { ...assigned, ...patch })).state, 'unknown');
  }
});

test('非法日历日期、24 点或秒 60 不得经日期滚动构造已确认到样', () => {
  for (const value of ['2026-02-30T00:00:00Z', '2026-09-09T24:00:00Z', '2026-09-09T04:00:60Z']) {
    const assignment = getProcSampleFacts(task('testing', { ...assigned, assignedAt: value }));
    assert.equal(assignment.state, 'unknown', `分派时间 ${value}`);
    assert.equal(assignment.evidence.at, null);
    const result = getProcSampleFacts(task('priced', { ...passed, assignedAt: '2026-01-01T00:00:00Z', confirmedAt: value }));
    assert.equal(result.state, 'unknown', `确认时间 ${value}`);
    assert.equal(result.evidence.at, null);
  }
});

test('回退日志的非法日历时刻不能被滚动成早于分派并继续沿用旧轮', () => {
  for (const value of ['2026-02-30T00:00:00Z', '2026-09-08T24:00:00Z', '2026-09-08T04:00:60Z']) {
    const result = getProcSampleFacts(task('priced', passed, { logs: [transition('priced', 'pending_sample', value)] }));
    assert.equal(result.state, 'unknown', value);
    assert.equal(result.evidence.roundId, null);
  }
});

test('合法闰日与跨时区分派确认仍按真实先后确认当前轮', () => {
  const sample = { ...passed, assignedAt: '2024-02-29T23:30:00-05:00', confirmedAt: '2024-03-01T04:45:00Z' };
  const result = getProcSampleFacts(task('priced', sample));
  assert.equal(result.state, 'confirmed');
  assert.equal(result.evidence.at, sample.confirmedAt);
  assert.equal(result.evidence.roundId, sample.roundId);
});

test('已通过但缺少本人结论记录或确认早于分派，不能显示已确认到样', () => {
  for (const patch of [{ confirmedAt: null }, { confirmedAt: '2026-09-09' }, { confirmedByName: '' }, { note: '' }, { confirmedAt: '2026-09-09T03:00:00.000Z' }]) {
    assert.equal(getProcSampleFacts(task('priced', { ...passed, ...patch })).state, 'unknown');
  }
});

test('ETA、批量到货、免费样品登记与自由日志文字都不构造到样事实', () => {
  const result = getProcSampleFacts(task('completed', null, { arrivedQty: 100, expectedArrivalDate: '2026-09-09',
    purchaseOrders: [{ freeSample: true, receivedQty: 1, etaDate: '2026-09-09' }],
    logs: [{ text: '样品已到，2026-09-09 收到', at: '2026-09-09' }],
  }));
  assert.equal(result.state, 'unknown');
  assert.equal(result.arrivedAt, null);
  assert.equal(result.evidence.at, null);
});

test('明确未要求样品的普通任务不伪造到样，显式样品阶段仍优先', () => {
  assert.equal(getProcSampleFacts(task('completed', null, { needSample: false })).state, 'not_required');
  assert.equal(getProcSampleFacts(task('inquiring', null, { needSample: false })).state, 'not_required');
  assert.equal(getProcSampleFacts(task('pending_sample', null, { needSample: false })).state, 'waiting');
  assert.equal(getProcSampleFacts(task('testing', null, { needSample: false })).state, 'unknown');
  assert.equal(getProcSampleFacts(task('priced', passed, { needSample: false })).state, 'confirmed');
});

test('同一输入结果稳定且不更改原始任务、测试轮次和日志', () => {
  const input = task('testing', { ...assigned }, { logs: [transition('pending_sample', 'testing', assigned.assignedAt)] });
  const before = structuredClone(input);
  assert.deepEqual(getProcSampleFacts(input), getProcSampleFacts(input));
  assert.deepEqual(input, before);
});
