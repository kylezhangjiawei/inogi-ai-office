import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
const source = readFileSync(new URL('../src/app/procurement/monthly-readiness/monthlyReadinessModel.ts', import.meta.url), 'utf8');
const code = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
const model = {};
const denied = () => assert.fail('月度齐套预览不得写接口或持久化');
new Function('exports', 'fetch', 'localStorage', 'sessionStorage', code)(model, denied, new Proxy({}, { get: denied }), new Proxy({}, { get: denied }));
const { createMonthlyReadinessState: seed, defaultReadinessInput: input, calculateMonthlyReadiness: calc, changeReadinessSource: sourceChange, saveMonthlyReadinessSnapshot: save, getMonthlyReadinessSummary: summary } = model;
const complete = () => sourceChange(seed(), 'verify-line');
const freeze = (value) => { Object.freeze(value); for (const item of Object.values(value)) if (item && typeof item === 'object' && !Object.isFrozen(item)) freeze(item); return value; };

test('整月需求只扣有效本月整机完工，组件、跨月和重复事件不累计', () => {
  const state = seed(); state.completions.push({ ...state.completions[0] }, { ...state.completions[0], eventId: 'unconfirmed', quantity: 80, confirmed: false });
  assert.equal(calc(state, input()).completed, 216); assert.equal(calc(state, input()).remaining, 784);
  assert.equal(calc(state, input('Q5')).remaining, 280); assert.equal(calc(state, input('Q7', '2026-08')).remaining, 0);
});
test('缺线边和 BOM 时保留已知数量但不声称确定齐套', () => {
  const result = calc(seed(), input()); assert.equal(result.currentKits, null); assert.equal(result.predictedKits, null); assert.equal(result.status, 'incomplete'); assert.equal(result.materialRows[0].warehouse, 520);
  const missing = calc(sourceChange(complete(), 'missing-bom'), input()); assert.equal(missing.currentKits, null); assert.match(missing.dataIssues.join(), /BOM/);
});
test('按物料合并仓库与确认线边后取全 BOM 最小值，预测不改变现货', () => {
  const state = complete(), result = calc(state, input()); assert.equal(result.currentKits, 600); assert.equal(result.predictedKits, 784); assert.equal(result.readyDate, '2026-09-26');
  assert.equal(result.materialRows[0].currentGap, 184); assert.equal(result.materialRows[0].orderGap, 0); assert.equal(result.materialRows[0].orderedByDate, 184);
  assert.deepEqual(result.timeline.map((point) => point.kits), [600, 680, 680, 784]);
});
test('A03/A04/A05 的标准算例按验收可用日期得到 240 → 270 → 270 → 300', () => {
  const state = complete(); state.asOf = '2026-09-08T14:00:00+08:00'; state.plans[0].target = 516;
  const quantities = [[180, 60], [230, 40], [460, 80], [2400, 0]];
  state.stocks.filter((row) => row.product === 'Q7').forEach((row, index) => { row.qualified = quantities[index][0]; row.frozen = 0; row.lineUnused = quantities[index][1]; });
  state.orders.filter((row) => row.product === 'Q7').forEach((row, index) => { row.ordered = [60, 30, 60][index]; row.accepted = 0; row.arrivalDate = '2026-09-09'; row.availableDate = `2026-09-${10 + index}`; });
  const result = calc(state, input()); assert.equal(result.remaining, 300); assert.deepEqual(result.materialRows.slice(0, 3).map((row) => row.currentGap), [60, 30, 60]); assert.deepEqual(result.timeline.map((point) => point.kits), [240, 270, 270, 300]);
  const byEleven = calc(state, { ...input(), mode: 'date', deadline: '2026-09-11' }); assert.equal(byEleven.predictedKits, 270); assert.equal(byEleven.currentKits, 240);
});
test('非重点 BOM 螺钉也限制全月齐套，不可只看重点料', () => {
  const state = complete(); const screws = state.stocks.find((row) => row.product === 'Q7' && row.materialId === 'screw'); screws.qualified = 4000; screws.frozen = 0; screws.lineUnused = 0;
  const result = calc(state, input()); assert.equal(result.predictedKits, 500); assert.equal(result.status, 'gap'); assert.equal(result.materialRows.at(-1).orderGap, 2272);
});
test('到货尚未检验可用、无效到货日期或未确认订单不进入按期预测', () => {
  const state = complete(); const valve = state.orders[0]; valve.arrivalDate = '2026-09-18'; valve.availableDate = '2026-10-03';
  let result = calc(state, input()); assert.equal(result.predictedKits, 600); assert.equal(result.materialRows[0].lateOrUncertain, 184);
  valve.availableDate = '2026-09-20'; valve.arrivalDate = ''; result = calc(state, input()); assert.equal(result.materialRows[0].orderedByDate, 0);
  valve.arrivalDate = '2026-09-19'; valve.confirmed = false; assert.equal(calc(state, input()).materialRows[0].orderedByDate, 0);
});
test('同一分配重复只取一次，同订单行重复分配阻止双计', () => {
  const state = complete(); state.orders.push({ ...state.orders[0] }); state.stocks.push({ ...state.stocks[0] });
  assert.equal(calc(state, input()).materialRows[0].orderedByDate, 184); assert.equal(calc(state, input()).currentKits, 600);
  state.orders.push({ ...state.orders[0], allocationId: 'duplicate-line' }); assert.equal(calc(state, input()).predictedKits, null); assert.match(calc(state, input()).dataIssues.join(), /同一订单行/);
});
test('订单晚到后的净缺口不会被未下单假设静默抵消', () => {
  const state = sourceChange(complete(), 'late-order'); const result = calc(state, { ...input(), includeUnplaced: true });
  assert.equal(result.predictedKits, 600); assert.equal(result.scenarioKits, 784); assert.equal(result.materialRows[0].orderGap, 184); assert.equal(result.currentKits, 600);
});
test('下月无正式目标为空，输入目标只能得到草稿情景', () => {
  const state = complete(); assert.equal(calc(state, input('Q7', '2026-10')).target, null);
  const result = calc(state, { ...input('Q7', '2026-10'), targetOverride: 900, includeUnplaced: true }); assert.equal(result.status, 'draft'); assert.equal(result.isDraft, true); assert.equal(result.completed, 0); assert.equal(result.remaining, 900); assert.equal(result.predictedKits, 784); assert.equal(result.scenarioKits, 825);
});
test('保存历史重算是追加快照，保留原对象与结果并拒绝过期来源', () => {
  const state = freeze(complete()), before = JSON.stringify(state.snapshots), result = calc(state, input());
  const next = save(state, result, state.version, 'new', '2026-09-14T04:00:00Z', state.snapshots[1].id); assert.equal(next.snapshots.length, 3); assert.equal(JSON.stringify(state.snapshots), before); assert.equal(next.snapshots.at(-1).sourceSnapshotId, state.snapshots[1].id);
  result.materialRows[0].warehouse = 1; assert.equal(next.snapshots.at(-1).result.materialRows[0].warehouse, 520);
  assert.equal(save(next, next.snapshots.at(-1).result, next.version, 'new', 'now'), next);
  assert.throws(() => save(sourceChange(state, 'late-order'), calc(state, input()), state.version, 'stale', 'now'), /已更新/);
  assert.throws(() => save(seed(), calc(seed(), input()), 3, 'incomplete', 'now'), /数据待补齐/);
});
test('当前数据模拟旧需求不捏造过去齐套日，时间线保持顺序', () => {
  const state = complete(); const result = calc(state, input('Q7', '2026-08')); assert.equal(result.readyDate, null); assert.deepEqual(result.timeline.map((point) => point.date), ['2026-09-14']);
  state.orders[0].availableDate = '2026-09-12'; state.orders[0].arrivalDate = '2026-09-11'; const current = calc(state, input()); assert.deepEqual(current.timeline.map((point) => point.date), [...current.timeline.map((point) => point.date)].sort());
});
test('无效日期、负库存、数量冲突和缺失单机用量均可见，不静默归零', () => {
  const state = complete(); state.stocks[0].qualified = -1; state.stocks[1].source = ''; state.boms[0].materials[1].per = 0; state.completions.push({ ...state.completions[0], quantity: 999 });
  const result = calc(state, { ...input(), mode: 'date', deadline: '2026-09-31' }); assert.equal(result.status, 'incomplete'); assert.match(result.dataIssues.join(), /有效日期/); assert.match(result.dataIssues.join(), /仓库数量矛盾/); assert.match(result.dataIssues.join(), /单机用量/); assert.match(result.dataIssues.join(), /数量冲突/); assert.match(result.dataIssues.join(), /库存来源依据/);
});
test('管理总览读取契约输出明确缺失状态，新种子互相独立', () => {
  const state = seed(); assert.deepEqual(summary(state), { product: 'Q7', month: '2026-09', target: 1000, completed: 216, remaining: 784, currentKits: null, predictedKits: null, status: 'incomplete', dataIssues: ['阀体 线边未耗用量待核对'], deadline: '2026-09-30' });
  state.plans[0].target = 1; assert.equal(seed().plans[0].target, 1000);
});
