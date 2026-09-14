import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

const source = readFileSync(new URL('../src/app/production/planning/planningModel.ts', import.meta.url), 'utf8');
const code = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
const forbidden = () => { throw new Error('计划演示不能访问接口、持久化或仓库'); };
const storage = new Proxy({}, { get: forbidden, set: forbidden }); const model = {};
new Function('exports', 'fetch', 'localStorage', 'sessionStorage', 'indexedDB', code)(model, forbidden, storage, storage, storage);
const { createPlanningState, validatePlanningAction, applyPlanningAction, getTaskProgress, getOperationTotals, getMonthlyProgress, buildPlanningCsv, canPlan } = model;
const now = '2026-09-11T05:00:00.000Z';
const task = (state, id = 'task-active') => state.tasks.find((item) => item.id === id);
const batch = (state, id = 'batch-new') => state.batches.find((item) => item.id === id);
const create = (patch = {}) => ({ kind: 'create', actorId: 'planner-a', batchId: 'batch-new', operationId: 'control', date: '2026-09-13', lineId: 'line-a', ownerId: 'line-a-owner', quantity: 20, note: '剩余控制组件安排', ...patch });
const adjust = (state, taskId = 'task-active', patch = {}) => {
  const { date, lineId, ownerId, quantity, note } = task(state, taskId);
  return { kind: 'adjust', actorId: 'planner-a', taskId, date, lineId, ownerId, quantity, note, reason: '核对现场情况后调整计划', ...patch };
};
const dispatch = (patch = {}) => ({ kind: 'dispatch', actorId: 'planner-a', taskId: 'task-draft', reviewed: true, note: '核对资料与需求后派工', ...patch });
const cancel = (patch = {}) => ({ kind: 'cancel', actorId: 'planner-a', taskId: 'task-draft', reason: '取消未开始安排并保留记录', ...patch });
const act = (state, input, version = state.version, at = now) => applyPlanningAction(state, version, input, at);
const freeze = (value) => { Object.freeze(value); for (const entry of Object.values(value)) if (entry && typeof entry === 'object' && !Object.isFrozen(entry)) freeze(entry); return value; };
function parseCsv(csv) {
  const rows = []; let row = []; let field = ''; let quoted = false; const text = csv.replace(/^\uFEFF/, '');
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (quoted) { if (char === '"' && text[i + 1] === '"') { field += '"'; i++; } else if (char === '"') quoted = false; else field += char; }
    else if (char === '"') quoted = true;
    else if (char === ',') { row.push(field); field = ''; }
    else if (char === '\r' && text[i + 1] === '\n') { row.push(field); rows.push(row); row = []; field = ''; i++; }
    else field += char;
  }
  return rows;
}

test('组件报工、工序计划和整机月度完工分别统计，不重复汇总工序产出', () => {
  const state = createPlanningState();
  assert.deepEqual(getTaskProgress(task(state)), { remaining: 24, notStarted: 20, reported: 40, qualified: 36, rework: 4 });
  assert.deepEqual(getOperationTotals(state, 'batch-new', 'control'), { planned: 100, required: 120, unplanned: 20, qualified: 36, rework: 4 });
  assert.deepEqual(getOperationTotals(state, 'batch-new', 'final'), { planned: 120, required: 120, unplanned: 0, qualified: 0, rework: 0 });
  assert.deepEqual(getMonthlyProgress(state, '2026-09', 'product-in100'), { target: 1000, completed: 216, remaining: 784 });
  assert.equal(batch(state).completed, 0); assert.equal(batch(state).readiness.current, 80); assert.equal(batch(state).readiness.onTime, 120);
});

test('月度目标支持产品和跨月筛选，计划日期与报工不代替完工来源日期', () => {
  const state = createPlanningState();
  assert.deepEqual(getMonthlyProgress(state, '2026-09', 'product-in200'), { target: 200, completed: 0, remaining: 200 });
  assert.deepEqual(getMonthlyProgress(state, '2026-10', 'product-in200'), { target: 80, completed: 0, remaining: 80 });
  assert.deepEqual(getMonthlyProgress(state, '2026-09'), { target: 1200, completed: 216, remaining: 984 });
  assert.deepEqual(getMonthlyProgress(state, '2026-11'), { target: 0, completed: 0, remaining: 0 });
  task(state, 'task-old-final').date = '2026-08-31'; task(state, 'task-old-final').actualDate = '2026-08-31';
  assert.equal(getMonthlyProgress(state, '2026-09', 'product-in100').completed, 216);
  batch(state, 'batch-old').completedDate = '2026-08-31';
  assert.equal(getMonthlyProgress(state, '2026-08', 'product-in100').completed, 116); assert.equal(getMonthlyProgress(state, '2026-09', 'product-in100').completed, 100);
  state.products[0].monthlyTargets['2026-09'] = 0;
  assert.equal(getMonthlyProgress(state, '2026-09', 'product-in100').remaining, 0);
  assert.throws(() => getMonthlyProgress(state, '2026-13'), /有效月份/); assert.throws(() => getMonthlyProgress(state, '2026-09', 'missing'), /有效产品/);
});

test('独立种子不共享资料、用料行、历史任务或批次对象', () => {
  const first = createPlanningState(); const second = createPlanningState();
  first.materialRequests[0].lines[0].issued = 999; batch(first).operations[0].documents[0].version = 'changed';
  assert.equal(second.materialRequests[0].lines[0].issued, 40); assert.equal(batch(second).operations[0].documents[0].version, 'V3.3');
  assert.equal(batch(second, 'batch-old').operations[0].documents[0].version, 'V3.2');
  assert.equal(batch(second, 'batch-old').archiveId, 'batch-02'); assert.equal(batch(second).ecnId, 'ecn-01');
  const communication = batch(second, 'batch-in200');
  assert.equal(communication.operations[0].documents.find((document) => document.code.startsWith('BOM-')).version, communication.bomVersion);
});

test('8 月未完任务保留在跨月批次，9 月仍可调整跟进且不虚增月度完工', () => {
  const state = createPlanningState(); const carry = batch(state, 'batch-carry'); const original = task(state, 'task-carry');
  assert.equal(carry.startDate, '2026-08-30'); assert.equal(carry.endDate, '2026-09-15'); assert.equal(carry.status, 'active');
  assert.equal(original.date, '2026-08-31'); assert.equal(original.status, 'draft'); assert.equal(original.quantity, 20);
  assert.deepEqual(getOperationTotals(state, 'batch-carry', 'control'), { planned: 20, required: 40, unplanned: 20, qualified: 0, rework: 0 });
  const next = act(state, adjust(state, 'task-carry', { date: '2026-09-12' }));
  assert.equal(task(next, 'task-carry').date, '2026-09-12'); assert.equal(next.events.at(-1).before.date, '2026-08-31');
  assert.equal(getMonthlyProgress(next, '2026-09', 'product-in100').completed, 216);
});

test('仅计划员和生产主管可更改，线长和未知岗位均只读', () => {
  const state = freeze(createPlanningState());
  assert.equal(canPlan(state, 'planner-a'), true); assert.equal(canPlan(state, 'supervisor-a'), true);
  for (const actorId of ['line-a-owner', 'line-b-owner', 'missing', '']) {
    assert.equal(canPlan(state, actorId), false);
    for (const action of [create(), adjust(state, 'task-active', { quantity: 55 }), dispatch(), cancel()]) {
      assert.ok(validatePlanningAction(state, { ...action, actorId }).actorId);
      assert.throws(() => act(state, { ...action, actorId }), /仅计划员或生产主管/);
    }
  }
  assert.equal(act(state, create({ actorId: 'supervisor-a' })).tasks.length, state.tasks.length + 1);
});

test('新增任务占用对应工序剩余计划量，不创建派工或用料需求', () => {
  const state = freeze(createPlanningState()); const input = freeze(create({ note: '  补充剩余安排  ' }));
  assert.deepEqual(validatePlanningAction(state, input), {}); const next = act(state, input); const added = next.tasks.at(-1);
  assert.equal(added.status, 'draft'); assert.equal(added.quantity, 20); assert.equal(added.note, '补充剩余安排'); assert.equal(added.revision, 1);
  assert.deepEqual(getTaskProgress(added), { remaining: 20, notStarted: 20, reported: 0, qualified: 0, rework: 0 });
  assert.equal(getOperationTotals(next, 'batch-new', 'control').unplanned, 0);
  assert.deepEqual(next.dispatches, state.dispatches); assert.deepEqual(next.materialRequests, state.materialRequests); assert.deepEqual(next.batches, state.batches);
  assert.equal(next.events.at(-1).after.quantity, 20); assert.deepEqual(next.events.at(-1).before, {});
  assert.equal(input.note, '  补充剩余安排  ');
});

test('同工序计划不得超需求，其他批次与其他工序不混算', () => {
  const state = createPlanningState();
  assert.ok(validatePlanningAction(state, create({ quantity: 21 })).quantity);
  assert.ok(validatePlanningAction(state, create({ operationId: 'final', quantity: 1 })).quantity);
  assert.throws(() => act(state, adjust(state, 'task-draft', { quantity: 61 })), /最多还可安排 60/);
  const cancelled = act(state, cancel());
  assert.deepEqual(getOperationTotals(cancelled, 'batch-new', 'control'), { planned: 60, required: 120, unplanned: 60, qualified: 36, rework: 4 });
  assert.equal(getTaskProgress(task(cancelled, 'task-draft')).remaining, 0);
  assert.equal(getOperationTotals(act(cancelled, create({ quantity: 60 })), 'batch-new', 'control').planned, 120);
});

for (const quantity of [0, -1, 1.5, Infinity, NaN, '20', null, Number.MAX_SAFE_INTEGER + 1]) test(`拒绝非正安全整数计划数量 ${String(quantity)}`, () => {
  const state = createPlanningState();
  assert.match(validatePlanningAction(state, create({ quantity })).quantity, /大于 0 的整数/);
  assert.throws(() => act(state, create({ quantity })), /大于 0 的整数/);
});

test('计划日期必须是真实日历日期且在批次窗口内，窗口晚于交期部分仍可排程', () => {
  const state = createPlanningState();
  for (const date of ['2026-02-30', '2026-13-01', '2026-9-11', '2026-09-09', '2026-09-18', '', null]) assert.ok(validatePlanningAction(state, create({ date })).date);
  for (const date of ['2026-09-10', '2026-09-15', '2026-09-17']) assert.equal(validatePlanningAction(state, create({ date })).date, undefined);
  assert.equal(act(state, create({ date: '2026-09-17' })).tasks.at(-1).date, '2026-09-17');
});

test('必须选择本工序允许的产线及对应线长，不接受跨线负责人或主管冒充', () => {
  const state = createPlanningState();
  for (const patch of [{ lineId: 'missing' }, { lineId: 'line-b', ownerId: 'line-a-owner' }, { ownerId: 'planner-a' }, { ownerId: 'supervisor-a' }, { ownerId: 'missing' }]) {
    const errors = validatePlanningAction(state, create(patch)); assert.ok(errors.lineId || errors.ownerId);
  }
  assert.ok(validatePlanningAction(state, adjust(state, 'task-final', { lineId: 'line-b', ownerId: 'line-b-owner' })).lineId);
  assert.deepEqual(validatePlanningAction(state, create({ lineId: 'line-b', ownerId: 'line-b-owner' })), {});
});

test('已派工调整更新同一派工和需求的数量日期版本，保留原确认人与时间及已发量', () => {
  const original = freeze(createPlanningState());
  const next = act(original, adjust(original, 'task-active', { quantity: 50, date: '2026-09-13', lineId: 'line-b', ownerId: 'line-b-owner' }));
  const updated = task(next); const dispatch = next.dispatches[0]; const request = next.materialRequests[0];
  assert.equal(updated.revision, 2); assert.equal(updated.quantity, 50); assert.equal(updated.date, '2026-09-13'); assert.equal(updated.lineId, 'line-b');
  assert.equal(dispatch.id, original.dispatches[0].id); assert.equal(dispatch.code, original.dispatches[0].code); assert.equal(dispatch.taskRevision, 2);
  assert.equal(dispatch.quantity, 50); assert.equal(dispatch.date, '2026-09-13'); assert.equal(dispatch.ownerId, 'line-b-owner');
  assert.equal(dispatch.actorId, original.dispatches[0].actorId); assert.equal(dispatch.confirmedAt, original.dispatches[0].confirmedAt);
  assert.equal(request.id, original.materialRequests[0].id); assert.equal(request.taskRevision, 2); assert.equal(request.neededDate, '2026-09-13');
  assert.deepEqual(request.lines.map((line) => line.quantity), [50, 50, 200]); assert.deepEqual(request.lines.map((line) => line.issued), [40, 40, 160]);
  assert.equal(next.dispatches.length, 1); assert.equal(next.materialRequests.length, 1);
  assert.equal(updated.actualDate, '2026-09-11'); assert.equal(updated.actualLineId, 'line-a');
  assert.deepEqual([updated.reported, updated.qualified, updated.rework], [40, 36, 4]); assert.equal(updated.status, 'in-progress');
  assert.deepEqual(next.batches, original.batches);
  const event = next.events.at(-1); assert.equal(event.before.quantity, 60); assert.equal(event.after.quantity, 50);
  assert.equal(JSON.parse(event.before.dispatch).taskRevision, 1); assert.equal(JSON.parse(event.after.dispatch).taskRevision, 2);
  assert.deepEqual(JSON.parse(event.before.materialRequest).lines.map((line) => line.quantity), [60, 60, 240]);
});

test('调整不能低于已报工或已发用料下限，包括非整除的螺钉用量', () => {
  const state = createPlanningState();
  assert.ok(validatePlanningAction(state, adjust(state, 'task-active', { quantity: 39 })).quantity);
  state.materialRequests[0].lines[2].issued = 161;
  assert.match(validatePlanningAction(state, adjust(state, 'task-active', { quantity: 40 })).quantity, /41 件/);
  assert.deepEqual(validatePlanningAction(state, adjust(state, 'task-active', { quantity: 41 })), {});
  const noMaterials = createPlanningState(); noMaterials.materialRequests = [];
  assert.ok(validatePlanningAction(noMaterials, adjust(noMaterials, 'task-active', { quantity: 50 }))._form);
});

test('草稿、已派工与开工调整均必须说明原因，且不能无变化提交', () => {
  const state = createPlanningState();
  assert.ok(validatePlanningAction(state, adjust(state, 'task-active', { quantity: 50, reason: '' })).reason);
  const dispatched = act(state, dispatch());
  assert.ok(validatePlanningAction(dispatched, adjust(dispatched, 'task-draft', { quantity: 45, reason: '' })).reason);
  assert.ok(validatePlanningAction(state, adjust(state, 'task-draft', { quantity: 45, reason: '' })).reason);
  assert.match(validatePlanningAction(state, adjust(state, 'task-active'))._form, /没有变化/);
});

test('调整不能通过额外字段切换任务批次或工序', () => {
  const state = createPlanningState();
  const next = act(state, { ...adjust(state, 'task-active', { quantity: 50 }), batchId: 'batch-in200', operationId: 'communication' });
  assert.equal(task(next).batchId, 'batch-new'); assert.equal(task(next).operationId, 'control');
});

test('派工一次性创建真实本地派工与用料需求，数量按 BOM 单件用量计算且初始已发为零', () => {
  const state = freeze(createPlanningState()); const next = act(state, dispatch());
  const updated = task(next, 'task-draft'); const dispatched = next.dispatches.find((item) => item.taskId === updated.id); const request = next.materialRequests.find((item) => item.taskId === updated.id);
  assert.equal(updated.status, 'dispatched'); assert.equal(updated.revision, 2);
  assert.equal(dispatched.quantity, 40); assert.equal(dispatched.lineId, 'line-b'); assert.equal(dispatched.ownerId, 'line-b-owner'); assert.equal(dispatched.confirmedAt, now);
  assert.deepEqual(request.lines.map((line) => line.quantity), [40, 40, 160]); assert.deepEqual(request.lines.map((line) => line.issued), [0, 0, 0]);
  assert.equal(request.taskRevision, updated.revision); assert.equal(dispatched.taskRevision, updated.revision);
  assert.deepEqual(next.batches, state.batches); assert.equal(getMonthlyProgress(next, '2026-09', 'product-in100').completed, 216);
  assert.throws(() => act(next, dispatch()), /重复/);
});

test('派工必须人工核对且 BOM、SOP、SIP 已发布齐全，缺失类别或版本均阻止', () => {
  const state = createPlanningState();
  for (const reviewed of [false, 'true', null]) assert.ok(validatePlanningAction(state, dispatch({ reviewed })).reviewed);
  assert.match(validatePlanningAction(state, dispatch({ taskId: 'task-in200' })).documents, /SIP/);
  for (const category of ['BOM', 'SOP', 'SIP']) for (const mode of ['missing', 'pending', 'empty']) {
    const changed = createPlanningState(); const operation = batch(changed).operations[0];
    if (mode === 'missing') operation.documents = operation.documents.filter((doc) => !doc.code.startsWith(category));
    else { const document = operation.documents.find((doc) => doc.code.startsWith(category)); if (mode === 'pending') document.status = 'pending'; else document.version = ''; }
    assert.match(validatePlanningAction(changed, dispatch()).documents, new RegExp(category));
  }
});

test('派工时重新核对保存的任务，坏日期、超量和重复关联不产生部分对象', () => {
  for (const patch of [{ date: '2026-02-30' }, { quantity: 70 }, { ownerId: 'line-a-owner' }]) {
    const state = createPlanningState(); Object.assign(task(state, 'task-draft'), patch); const before = JSON.stringify(state);
    assert.throws(() => act(state, dispatch())); assert.equal(JSON.stringify(state), before);
  }
  const state = createPlanningState(); state.dispatches[0].taskId = 'task-draft';
  assert.throws(() => act(state, dispatch()), /已有派工或用料需求/);
});

test('取消仅限尚未报工的草稿，保留原记录与原因并释放计划额度', () => {
  const state = freeze(createPlanningState()); const next = act(state, cancel());
  assert.equal(task(next, 'task-draft').status, 'cancelled'); assert.equal(task(next, 'task-draft').quantity, 40);
  assert.equal(getOperationTotals(next, 'batch-new', 'control').planned, 60);
  assert.equal(next.events.at(-1).before.status, 'draft'); assert.equal(next.events.at(-1).after.status, 'cancelled');
  assert.throws(() => act(next, cancel()), /取消/); assert.throws(() => act(state, cancel({ reason: '' })), /取消原因/);
  assert.throws(() => act(state, cancel({ taskId: 'task-active' })), /只有尚未报工|不能按草稿取消/);
  for (const field of ['reported', 'qualified', 'rework']) { const changed = createPlanningState(); task(changed, 'task-draft')[field] = 1; assert.throws(() => act(changed, cancel()), /只有尚未报工/); }
});

test('已结案批次及完成 / 取消任务只读，不能新增或续派工', () => {
  const state = createPlanningState();
  assert.throws(() => act(state, create({ batchId: 'batch-old', date: '2026-09-07', quantity: 1 })), /结案/);
  assert.throws(() => act(state, adjust(state, 'task-old-final', { quantity: 115 })), /已完成|结案/);
  assert.throws(() => act(state, dispatch({ taskId: 'task-old-final' })), /草稿|重复|完成|结案/);
  const cancelled = act(state, cancel()); assert.throws(() => act(cancelled, adjust(cancelled, 'task-draft', { quantity: 30 })), /已取消/);
});

test('字段级校验处理缺失对象与超长内容，不抛运行时错误或修改原值', () => {
  const state = freeze(createPlanningState());
  assert.ok(validatePlanningAction(state, null)._form); assert.ok(validatePlanningAction(state, { kind: 'invalid' })._form);
  assert.ok(validatePlanningAction(state, create({ batchId: 'missing' })).batchId); assert.ok(validatePlanningAction(state, create({ operationId: 'missing' })).operationId);
  assert.ok(validatePlanningAction(state, dispatch({ taskId: 'missing' }))._form);
  for (const note of [null, 123, 'x'.repeat(1001)]) assert.ok(validatePlanningAction(state, create({ note })).note);
  assert.ok(validatePlanningAction(state, cancel({ reason: 'x'.repeat(1001) })).reason);
});

test('旧状态版本和错误时间拒绝全部提交，源状态与表单输入保持不变', () => {
  const state = freeze(createPlanningState()); const input = freeze(create()); const original = JSON.stringify(state);
  for (const version of [0, 2, 1.5, NaN, '1']) assert.throws(() => act(state, input, version), /数据已变化/);
  assert.throws(() => act(state, input, 1, 'invalid'), /操作时间无效/);
  const next = act(state, input); assert.throws(() => act(next, input, 1), /数据已变化/);
  assert.equal(JSON.stringify(state), original); assert.equal(input.quantity, 20);
});

test('历史快照与现存派工 / 用料对象深度独立，后续调整不覆写前次记录', () => {
  const state = createPlanningState(); const first = act(state, adjust(state, 'task-active', { quantity: 50 }));
  const second = act(first, adjust(first, 'task-active', { quantity: 45 }));
  assert.equal(second.events[0].after.quantity, 50); assert.equal(second.events[1].before.quantity, 50); assert.equal(second.events[1].after.quantity, 45);
  second.materialRequests[0].lines[0].quantity = 999;
  assert.equal(JSON.parse(second.events[1].after.materialRequest).lines[0].quantity, 45);
  assert.equal(first.materialRequests[0].lines[0].quantity, 50);
});

test('导出包含批次、所有工序资料、任务实际事实、派工需求以及完整修改前后历史', () => {
  const original = createPlanningState(); const state = act(original, adjust(original, 'task-active', { quantity: 50 }));
  const csv = buildPlanningCsv(freeze(state), 'batch-new'); const rows = parseCsv(csv);
  assert.equal(csv.charCodeAt(0), 0xFEFF); assert.ok(rows.every((row) => row.length === 4));
  for (const section of ['批次', '齐套摘要', '产品及月度目标', '工序', '任务与实际报工', '派工记录', '用料需求', '操作历史']) assert.ok(rows.some((row) => row[0] === section), section);
  for (const value of ['B-FG-0910', 'PP-202609-010', 'BOM-V3.3', 'BOM-CONTROL', 'SOP-CONTROL', 'SIP-CONTROL', 'MAT-PCB-100', 'MAT-SHELL-100', 'MAT-SCREW-M3']) assert.ok(rows.some((row) => row[3] === value), value);
  const before = rows.find((row) => row[0] === '操作历史' && row[2] === '操作前完整快照');
  const after = rows.find((row) => row[0] === '操作历史' && row[2] === '操作后完整快照');
  assert.equal(JSON.parse(before[3]).quantity, 60); assert.equal(JSON.parse(after[3]).quantity, 50);
  assert.equal(JSON.parse(JSON.parse(after[3]).materialRequest).lines[2].issued, 160);
  assert.ok(rows.some((row) => row[3].includes('不分配或扣减库存')));
});

test('CSV正确保留中文、引号、换行和零值，阻止公式与空白 / 控制字符绕过', () => {
  const state = createPlanningState(); task(state).note = '中文,"备注"\n换行';
  assert.ok(parseCsv(buildPlanningCsv(state, 'batch-new')).some((row) => row[3] === '中文,"备注"\n换行'));
  assert.ok(parseCsv(buildPlanningCsv(state, 'batch-new')).some((row) => row[0] === '批次' && row[2] === '整机完工数量' && row[3] === '0'));
  for (const note of ['=1+1', '+SUM(A1)', '-1+1', '@SUM(A1)', '  =1+1', '\t=1+1', '\r\n+1', '\u0000@SUM(A1)', '\uFEFF=1+1', '\ttext']) {
    task(state).note = note; const row = parseCsv(buildPlanningCsv(state, 'batch-new')).find((row) => row[0] === '任务与实际报工' && row[1] === 'TASK-0911-001' && row[2] === '说明');
    assert.equal(row[3], `'${note}`);
  }
});

test('导出和统计是纯读取，导出不会混入其他批次任务及记录', () => {
  const state = freeze(createPlanningState()); const original = JSON.stringify(state); const csv = buildPlanningCsv(state, 'batch-new');
  assert.equal(csv.includes('TASK-1003-003'), false); assert.equal(csv.includes('TASK-0907-002'), false);
  assert.throws(() => buildPlanningCsv(state, 'missing'), /批次已不存在/);
  assert.throws(() => getOperationTotals(state, 'batch-new', 'missing'), /工序已不存在/);
  assert.equal(JSON.stringify(state), original);
});
