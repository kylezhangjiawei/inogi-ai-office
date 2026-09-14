import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

const source = readFileSync(new URL('../src/app/production/ecn/ecnModel.ts', import.meta.url), 'utf8');
const code = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
const forbidden = () => { throw new Error('ECN 演示不可调用接口、通知或持久化'); };
const storage = new Proxy({}, { get: forbidden, set: forbidden });
const model = {};
new Function('exports', 'fetch', 'localStorage', 'sessionStorage', 'indexedDB', code)(model, forbidden, storage, storage, storage);
const { createEcnState, getEcnProgress, getArchiveBlockers, validateEcnAction, applyEcnAction, buildEcnCsv, isEcnImpactVerified } = model;
const now = '2026-09-11T04:00:00.000Z';
const record = (state, id = 'ecn-01') => state.records.find((item) => item.id === id);
const progress = (state) => getEcnProgress(state, 'ecn-01');
const act = (state, input, at = now, version = state.version) => applyEcnAction(state, 'ecn-01', version, input, at);
const ack = (actorId = 'line-a', impactIds = ['impact-new', 'impact-old']) => ({ kind: 'acknowledge', actorId, reviewed: true, impactIds, note: '已核对发布摘要与适用范围' });
const disposition = (targetId = 'legacy-stock', choice = 'retain') => ({ kind: 'disposition', actorId: 'process-a', targetId, choice, reason: '根据随批依据保留旧版处理记录' });
const feedback = (patch = {}) => ({ kind: 'feedback', actorId: 'line-a', impactId: 'impact-new', ownerId: 'process-a', dueDate: '2026-09-15', description: '执行检查发现需补充复核的项目', ...patch });
const resolve = (taskId = 'task-seed', actorId = 'process-a') => ({ kind: 'resolve-task', actorId, taskId, resolution: '已核对并完成问题处理，等待质量验证' });
const verify = (patch = {}) => ({ kind: 'verify', actorId: 'quality-a', impactId: 'impact-new', result: 'passed', evidenceId: 'verification-new', note: '按已发布验证凭据核验新版执行结果', ...patch });
const archive = { kind: 'archive', actorId: 'quality-a', reason: '适用范围、岗位确认、处置和执行验证均已核对' };
function ready(state = createEcnState()) {
  state = act(state, ack('line-a')); state = act(state, ack('line-b'));
  state = act(state, disposition()); state = act(state, disposition('legacy-order', 'revise-order'));
  state = act(state, resolve()); return act(state, verify());
}
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

test('三类演示状态独立，已阅、旧版处置、协同问题与执行验证分别计数', () => {
  const state = createEcnState();
  assert.deepEqual(state.records.map((item) => item.status), ['published', 'draft', 'archived']);
  assert.deepEqual(progress(state), { acknowledged: 1, required: 3, undecided: 2, openTasks: 1, verified: 0, verificationRequired: 1, stage: 1 });
  assert.equal(getEcnProgress(state, 'ecn-02').stage, 0); assert.equal(getEcnProgress(state, 'ecn-03').stage, 4);
  assert.equal(record(state).impacts[0].quantity, 120); assert.equal(record(state).impacts[1].quantity, 116);
  assert.equal(record(state).impacts[1].applicability, 'retain');
  const remaining = record(state).legacyTargets.find((target) => target.id === 'legacy-wip');
  assert.equal(remaining.quantity, 36); assert.equal(remaining.quantity + 80, record(state).impacts[1].quantity);
  assert.match(remaining.label, /已放行 20 台、待放行 16 台/);
  assert.match(record(state, 'ecn-02').effectiveRule, /尚未生效/);
  for (const item of state.records) for (const document of item.documents.filter((doc) => doc.status === 'draft')) assert.match(document.summary, /未发布资料草稿/);
  assert.equal(getArchiveBlockers(state, 'ecn-01').length, 6);
});

test('创建状态不共享来源、数组和历史记录，全部来源 ID 均有效', () => {
  const first = createEcnState(); const second = createEcnState();
  record(first).documents[0].facts[0].value = 'changed'; record(first).impacts[0].quantity = 999;
  assert.notEqual(record(second).documents[0].facts[0].value, 'changed'); assert.equal(record(second).impacts[0].quantity, 120);
  for (const item of second.records) {
    const docs = new Set(item.documents.map((document) => document.id)); const impacts = new Set(item.impacts.map((impact) => impact.id));
    for (const difference of item.differences) { assert.ok(docs.has(difference.beforeDocumentId)); assert.ok(docs.has(difference.afterDocumentId)); }
    for (const document of item.documents) assert.ok(document.impactIds.every((id) => impacts.has(id)));
  }
});

test('完整执行后仅归档 ECN，不改变生产批次、物料、订单或受控来源事实', () => {
  const initial = freeze(createEcnState()); const prepared = ready(initial);
  assert.deepEqual(progress(prepared), { acknowledged: 3, required: 3, undecided: 0, openTasks: 0, verified: 1, verificationRequired: 1, stage: 3 });
  assert.deepEqual(getArchiveBlockers(prepared, 'ecn-01'), []);
  const next = act(prepared, archive);
  assert.equal(record(next).status, 'archived'); assert.equal(record(next).archivedBy, 'quality-a'); assert.equal(record(next).archivedAt, now);
  assert.equal(progress(next).stage, 4);
  for (const key of ['documents', 'differences', 'impacts', 'legacyTargets']) assert.deepEqual(record(next)[key], record(initial)[key]);
  assert.deepEqual(next.records.slice(1), initial.records.slice(1)); assert.deepEqual(next.actors, initial.actors);
  assert.equal(record(initial).status, 'published'); assert.equal(record(initial).tasks[0].status, 'open');
  assert.equal(record(next).events.at(-1).kind, 'archive');
});

test('岗位确认支持分次覆盖范围；非必需岗位已阅不会代替必需岗位', () => {
  let state = act(createEcnState(), ack('line-a', ['impact-new']));
  assert.equal(progress(state).acknowledged, 1);
  state = act(state, ack('line-a', ['impact-old'])); assert.equal(progress(state).acknowledged, 2);
  state = act(state, ack('buyer-a')); assert.equal(progress(state).acknowledged, 2);
  state = act(state, ack('line-b')); assert.equal(progress(state).acknowledged, 3); assert.equal(progress(state).stage, 2);
  assert.equal(progress(state).verified, 0, '确认已阅不能被计为执行验证');
});

test('岗位已阅要求阅读确认及非空、唯一、已有适用范围，拒绝重复覆盖', () => {
  const state = createEcnState();
  for (const patch of [{ reviewed: false }, { reviewed: 'true' }, { impactIds: [] }, { impactIds: ['impact-new', 'impact-new'] }, { impactIds: ['missing'] }, { impactIds: null }]) assert.throws(() => act(state, { ...ack(), ...patch }), /阅读|范围/);
  assert.throws(() => act(state, ack('quality-a')), /已确认/);
  const covered = act(state, ack('line-a', ['impact-new']));
  assert.throws(() => act(covered, ack('line-a', ['impact-new'])), /已确认/);
  assert.equal(progress(act(covered, ack('line-a'))).acknowledged, 2);
});

test('旧版处置严格依岗位与对象种类，决定不会自动改库存、在制品或采购订单', () => {
  const state = freeze(createEcnState());
  for (const actorId of ['line-a', 'line-b', 'buyer-a']) assert.throws(() => act(state, { ...disposition(), actorId }), /工艺.*质量/);
  for (const [targetId, choice] of [['legacy-stock', 'revise-order'], ['legacy-wip', 'return'], ['legacy-order', 'scrap'], ['legacy-order', 'rework']]) assert.throws(() => act(state, disposition(targetId, choice)), /不支持此处置/);
  assert.throws(() => act(state, disposition('missing')), /有效旧版对象/);
  const next = act(state, { ...disposition(), actorId: 'quality-a' });
  assert.deepEqual(record(next).legacyTargets, record(state).legacyTargets); assert.deepEqual(record(next).impacts, record(state).impacts);
  assert.equal(progress(next).undecided, 1);
});

test('处置修改追加历史与操作前后快照；暂缓仍阻止归档', () => {
  const initial = createEcnState();
  const first = act(initial, disposition('legacy-stock', 'retain'));
  const next = act(first, { ...disposition('legacy-stock', 'hold'), reason: '新信息需重新核实' });
  assert.equal(record(next).dispositions.length, 4);
  assert.equal(record(next).dispositions.at(-2).choice, 'retain'); assert.equal(record(next).dispositions.at(-1).choice, 'hold');
  assert.equal(JSON.parse(record(next).events.at(-1).before).choice, 'retain'); assert.equal(JSON.parse(record(next).events.at(-1).after).choice, 'hold');
  assert.equal(progress(next).undecided, 2);
  assert.throws(() => act(first, disposition()), /没有变化/);
});

test('执行反馈创建实际本地待办，责任岗位、日期和问题描述均被保留', () => {
  const initial = freeze(createEcnState()); const action = freeze(feedback({ description: '  检查端口标签  ' }));
  validateEcnAction(initial, 'ecn-01', action, now);
  const next = act(initial, action); const task = record(next).tasks.at(-1);
  assert.equal(task.ownerId, 'process-a'); assert.equal(task.dueDate, '2026-09-15'); assert.equal(task.description, '检查端口标签');
  assert.equal(task.status, 'open'); assert.equal(task.at, now); assert.equal(progress(next).openTasks, 2);
  assert.equal(record(initial).tasks.length, 1); assert.equal(action.description, '  检查端口标签  ');
  assert.equal(JSON.parse(record(next).events.at(-1).after).id, task.id);
});

test('待办必须归属已知范围与责任岗位，日期按本次操作的上海自然日校验', () => {
  const state = createEcnState();
  for (const patch of [{ impactId: 'missing' }, { ownerId: 'missing' }, { description: '' }, { description: 'x'.repeat(2001) }]) assert.throws(() => act(state, feedback(patch)));
  for (const dueDate of ['2026-09-10', '2026-02-30', '2026-13-01', '2026-9-15', 'tomorrow', '']) assert.throws(() => act(state, feedback({ dueDate })), /日期/);
  assert.equal(record(act(state, feedback({ dueDate: '2026-09-11' }))).tasks.at(-1).dueDate, '2026-09-11');
  assert.throws(() => act(state, feedback({ dueDate: '2026-09-11' }), '2026-09-11T16:00:00.000Z'), /不能早于今天/);
  const futureTime = '2030-01-01T00:00:00.000Z';
  assert.equal(record(act(state, feedback({ dueDate: '2030-01-01' }), futureTime)).tasks.at(-1).dueDate, '2030-01-01');
  assert.equal(record(act(state, feedback({ dueDate: '2028-02-29' }))).tasks.at(-1).dueDate, '2028-02-29');
});

test('待办仅责任岗位或工艺 / 质量可处理，保留原问题与处理历史', () => {
  const initial = act(createEcnState(), feedback({ ownerId: 'buyer-a' })); const taskId = record(initial).tasks.at(-1).id;
  assert.throws(() => act(initial, resolve(taskId, 'line-b')), /仅责任岗位/);
  const next = act(initial, resolve(taskId, 'buyer-a'));
  const task = record(next).tasks.at(-1);
  assert.equal(task.status, 'resolved'); assert.equal(task.description, record(initial).tasks.at(-1).description);
  assert.equal(task.resolvedBy, 'buyer-a'); assert.equal(task.resolvedAt, now);
  const event = record(next).events.at(-1); assert.equal(JSON.parse(event.before).status, 'open'); assert.equal(JSON.parse(event.after).status, 'resolved');
  assert.throws(() => act(next, resolve(taskId, 'buyer-a')), /不能重复处理/);
  assert.throws(() => act(initial, { ...resolve(taskId), resolution: '' }), /处理结果/);
  assert.throws(() => act(initial, resolve('missing')), /待办已不存在/);
  assert.equal(record(act(initial, resolve(taskId, 'quality-a'))).tasks.at(-1).status, 'resolved');
});

test('执行验证只允许质量与适用新版批次，凭据须已发布且覆盖本批', () => {
  const state = act(createEcnState(), resolve());
  for (const actorId of ['line-a', 'process-a', 'buyer-a']) assert.throws(() => act(state, verify({ actorId })), /质量岗位/);
  assert.throws(() => act(state, verify({ impactId: 'impact-old' })), /明确适用新版/);
  for (const evidenceId of ['missing', 'drawing-after', 'verification-draft']) assert.throws(() => act(state, verify({ evidenceId })), /覆盖本批次的已发布/);
  const other = structuredClone(state); record(other).documents.find((doc) => doc.id === 'verification-new').impactIds = ['impact-old'];
  assert.throws(() => act(other, verify()), /覆盖本批次的已发布/);
  assert.throws(() => act(state, verify({ result: 'unknown' })), /有效的验证结果/);
  assert.throws(() => act(state, verify({ note: '' })), /验证说明/);
});

test('未结执行问题阻止验证合格，但允许登记不合格保留结果', () => {
  const state = createEcnState();
  assert.throws(() => act(state, verify()), /未完成的协同待办/);
  const failed = act(state, verify({ result: 'failed', note: '问题仍未解决，检查未通过' }));
  assert.equal(record(failed).verifications.at(-1).result, 'failed'); assert.equal(progress(failed).verified, 0);
});

test('失败验证不被历史合格掩盖，后续再次合格才解除该条件', () => {
  const prepared = ready();
  const failed = act(prepared, verify({ result: 'failed', note: '复核发现遗漏' }));
  assert.equal(progress(failed).verified, 0); assert.ok(getArchiveBlockers(failed, 'ecn-01').some((item) => item.includes('执行验证合格')));
  const passed = act(failed, verify({ note: '遗漏已核实，重新验证合格' }));
  assert.equal(progress(passed).verified, 1); assert.equal(record(passed).verifications.length, 3);
  assert.deepEqual(record(passed).verifications.map((item) => item.result), ['passed', 'failed', 'passed']);
});

test('后续同批次问题使之前验证失效，处理完成后仍需重新验证（包含同时间戳）', () => {
  for (const problemAt of [now, '2026-09-11T05:00:00.000Z']) {
    const prepared = ready(); const issue = act(prepared, feedback(), problemAt); const taskId = record(issue).tasks.at(-1).id;
    assert.equal(isEcnImpactVerified(record(prepared), 'impact-new'), true);
    assert.equal(isEcnImpactVerified(record(issue), 'impact-new'), false);
    assert.equal(progress(issue).verified, 0); assert.equal(progress(issue).openTasks, 1);
    const handled = act(issue, resolve(taskId), problemAt); assert.equal(progress(handled).verified, 0);
    assert.throws(() => act(handled, archive, problemAt), /执行验证合格/);
    const passed = act(handled, verify(), problemAt); assert.equal(progress(passed).verified, 1); assert.deepEqual(getArchiveBlockers(passed, 'ecn-01'), []);
  }
});

test('旧版保留范围的问题仍阻止归档，但不抹去其他新版批次的验证', () => {
  const state = act(ready(), feedback({ impactId: 'impact-old' }));
  assert.equal(progress(state).verified, 1); assert.equal(progress(state).openTasks, 1);
  assert.throws(() => act(state, archive), /协同待办尚未完成/);
});

test('归档严格要求质量岗位与全部确认、处置、待办和有效验证', () => {
  const state = createEcnState();
  assert.throws(() => act(state, archive), /暂不能归档/);
  const prepared = ready();
  for (const actorId of ['line-a', 'process-a', 'buyer-a']) assert.throws(() => act(prepared, { ...archive, actorId }), /质量岗位/);
  for (const alter of [
    (item) => { item.acknowledgements = item.acknowledgements.filter((ack) => ack.actorId !== 'line-a'); },
    (item) => { item.impacts[1].applicability = 'pending'; },
    (item) => { item.dispositions = item.dispositions.filter((decision) => decision.targetId !== 'legacy-stock'); },
    (item) => { item.tasks[0].status = 'open'; },
    (item) => { item.verifications = []; },
  ]) { const changed = structuredClone(prepared); alter(record(changed)); assert.throws(() => act(changed, archive), /暂不能归档/); }
  assert.throws(() => act(prepared, { ...archive, reason: ' ' }), /归档说明/);
});

test('所有动作均拒绝草稿与已归档记录，不能隐式发布或重新开启', () => {
  const state = freeze(createEcnState());
  for (const recordId of ['ecn-02', 'ecn-03']) for (const action of [ack(), disposition(), feedback(), resolve(), verify(), archive]) assert.throws(() => applyEcnAction(state, recordId, 1, action, now), /尚未发布|已归档/);
  const archived = act(ready(), archive);
  assert.throws(() => act(archived, archive), /已归档/);
});

test('陈旧版本、重复提交、无效岗位和操作时间被拒绝且原状态不变', () => {
  const state = freeze(createEcnState());
  for (const version of [0, 2, 1.1, NaN, '1']) assert.throws(() => act(state, ack(), now, version), /数据已变化/);
  const next = act(state, ack()); assert.throws(() => act(next, ack(), now, 1), /数据已变化/);
  assert.throws(() => act(state, { ...ack(), actorId: 'missing' }), /有效的操作岗位/);
  assert.throws(() => act(state, ack(), 'invalid'), /操作时间无效/);
  assert.throws(() => applyEcnAction(state, 'missing', 1, ack(), now), /记录已不存在/);
  assert.throws(() => act(state, { ...ack(), kind: 'publish' }), /不支持的变更操作/);
  assert.equal(state.version, 1); assert.equal(record(state).acknowledgements.length, 1);
});

test('修订事件与其他状态均深度独立，保留操作前后对象而非共享引用', () => {
  const before = freeze(createEcnState()); const next = act(before, disposition());
  const afterSnapshot = JSON.parse(record(next).events.at(-1).after);
  record(next).dispositions.at(-1).reason = '之后意外改动';
  assert.equal(afterSnapshot.reason, '根据随批依据保留旧版处理记录');
  assert.equal(JSON.parse(record(next).events.at(-1).after).reason, afterSnapshot.reason);
  assert.equal(record(before).dispositions.length, 2);
});

test('生成的实体与事件编号不会碰撞已有编号', () => {
  const state = createEcnState(); record(state).acknowledgements[0].id = 'ecn-ack-2';
  record(state).events.push({ id: 'ecn-event-2', kind: 'acknowledge', actorId: 'quality-a', at: now, summary: '既有记录', before: '', after: '' });
  const next = act(state, ack());
  assert.equal(record(next).acknowledgements.at(-1).id, 'ecn-ack-2-1'); assert.equal(record(next).events.at(-1).id, 'ecn-event-2-1');
});

test('导出包含来源版本、适用范围、处置历史、岗位确认、问题与验证、完整操作记录', () => {
  const state = ready(); const csv = buildEcnCsv(freeze(state), 'ecn-01'); const rows = parseCsv(csv);
  assert.equal(csv.charCodeAt(0), 0xFEFF); assert.ok(rows.every((row) => row.length === 4));
  for (const section of ['变更基本资料', '来源摘要', '变更对比', '适用范围', '旧版对象', '岗位确认', '旧版处置历史', '协同待办', '执行验证历史', '操作记录']) assert.ok(rows.some((row) => row[0] === section), section);
  for (const value of ['HW-C', 'HW-D', 'V1.1.0', 'V1.2.0', 'BOM-V3.2', 'BOM-V3.3', 'SOP-C', 'SOP-D', 'SIP-C', 'SIP-D', 'B-FG-0910', 'B-FG-0902', 'hold', 'revise-order']) assert.ok(rows.some((row) => row[3] === value), value);
  for (const event of record(state).events) {
    assert.ok(rows.some((row) => row[0] === '操作记录' && row[1] === event.id && row[3] === event.after));
    if (event.before) assert.ok(rows.some((row) => row[0] === '操作记录' && row[1] === event.id && row[3] === event.before));
  }
  assert.ok(rows.some((row) => row[3].includes('不会发送消息'))); assert.ok(rows.some((row) => row[3].includes('正式原图')));
});

test('导出保留中文、逗号、引号与换行并防止公式及前导空白绕过', () => {
  const state = createEcnState(); record(state).summary = '中文,"摘要"\n下一行';
  assert.ok(parseCsv(buildEcnCsv(state, 'ecn-01')).some((row) => row[3] === '中文,"摘要"\n下一行'));
  for (const value of ['=1+1', '+SUM(A1)', '-1+1', '@SUM(A1)', '  =1+1', '\t=1+1', '\r\n+1', '\u0000@SUM(A1)', '\uFEFF=1+1', '\ttext']) {
    record(state).documents[0].facts = [{ label: value, value }];
    const row = parseCsv(buildEcnCsv(state, 'ecn-01')).find((item) => item[0] === '来源摘要明细' && item[1] === 'drawing-before');
    assert.equal(row[2], `'${value}`); assert.equal(row[3], `'${value}`);
  }
});

test('导出仅包含所选变更，纯读取不会更改状态', () => {
  const state = freeze(createEcnState()); const before = JSON.stringify(state);
  const csv = buildEcnCsv(state, 'ecn-03');
  assert.equal(csv.includes('ECN-202609-003'), false); assert.equal(csv.includes('ECN-TASK-001'), false);
  assert.throws(() => buildEcnCsv(state, 'missing'), /记录已不存在/);
  assert.equal(JSON.stringify(state), before);
});
