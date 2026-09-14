import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

const source = readFileSync(new URL('../src/app/production/field-tasks/fieldModel.ts', import.meta.url), 'utf8');
const code = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
const forbidden = () => { throw new Error('现场演示不能访问接口、仓库或持久化'); };
const storage = new Proxy({}, { get: forbidden, set: forbidden }); const model = {};
new Function('exports', 'fetch', 'localStorage', 'sessionStorage', 'indexedDB', code)(model, forbidden, storage, storage, storage);
const { createFieldState, fieldToday, canOperateField, getFieldProgress, getReportUnregistered, getReturnable, validateFieldAction, applyFieldAction, buildFieldCsv } = model;
const now = '2026-09-11T05:00:00.000Z'; const today = '2026-09-11';
const task = (state, id = 'task-active') => state.tasks.find((item) => item.id === id);
const base = { actorId: 'line-a-owner', taskId: 'task-active' };
const report = (patch = {}) => ({ ...base, kind: 'report', date: today, actual: 10, good: 8, bad: 2, note: '现场报工记录', ...patch });
const defect = (patch = {}) => ({ ...base, kind: 'defect', reportId: 'report-seed', quantity: 2, phenomenon: '功能异常', description: '通信测试未通过，等待质量处理', issueId: 'issue-main-signed', photos: [], ...patch });
const returned = (patch = {}) => ({ ...base, kind: 'return', issueId: 'issue-main-signed', quantity: 2, reason: '核对现场尚未使用的余料后申请退回', reviewed: true, ...patch });
const sign = (patch = {}) => ({ ...base, kind: 'sign', issueId: 'issue-shell-pending', reviewed: true, ...patch });
const accept = (patch = {}) => ({ actorId: 'line-b-owner', taskId: 'task-pending', kind: 'accept', reviewed: true, ...patch });
const draft = (patch = {}) => ({ ...base, kind: 'save-draft', draft: { date: '', actual: '1.', good: '', bad: '', note: '未填完的草稿' }, ...patch });
const photo = (patch = {}) => ({ id: 'photo-1', name: '现场.png', type: 'image/png', size: 1, dataUrl: 'data:image/png;base64,AA==', ...patch });
const act = (state, input, time = now, version = state.version) => applyFieldAction(state, version, input, time);
const errors = (state, input, day = today) => validateFieldAction(state, input, day);
const freeze = (value) => { Object.freeze(value); for (const entry of Object.values(value)) if (entry && typeof entry === 'object' && !Object.isFrozen(entry)) freeze(entry); return value; };
function parseCsv(csv) {
  const rows = []; let row = []; let field = ''; let quoted = false; const text = csv.replace(/^\uFEFF/, '');
  for (let i = 0; i < text.length; i++) { const char = text[i]; if (quoted) { if (char === '"' && text[i + 1] === '"') { field += '"'; i++; } else if (char === '"') quoted = false; else field += char; } else if (char === '"') quoted = true; else if (char === ',') { row.push(field); field = ''; } else if (char === '\r' && text[i + 1] === '\n') { row.push(field); rows.push(row); row = []; field = ''; i++; } else field += char; }
  return rows;
}

test('现场报工、不良登记池和领料申请上限分别统计', () => {
  const state = createFieldState();
  assert.deepEqual(getFieldProgress(state, 'task-active'), { reported: 40, good: 36, bad: 4, unreported: 20, unregisteredBad: 2, registeredBad: 2 });
  assert.equal(getReportUnregistered(state, 'report-seed'), 2); assert.equal(getReturnable(state, 'issue-main-signed'), 40); assert.equal(getReturnable(state, 'issue-shell-pending'), 0);
  assert.equal(task(state).planned, 60); assert.equal(task(state, 'task-pending').planned, 40); assert.equal(task(state, 'task-pending').acceptedAt, undefined);
});

test('演示种子与日期工具独立，业务日期按上海午夜切换', () => {
  const first = createFieldState(); const second = createFieldState(); first.issues[0].lotCode = 'changed'; first.tasks[0].documents[0].version = 'changed';
  assert.equal(second.issues[0].lotCode, 'PCB-260910-D'); assert.equal(second.tasks[0].documents[0].version, 'V3.3');
  assert.equal(fieldToday('2026-09-11T15:59:59.000Z'), '2026-09-11'); assert.equal(fieldToday('2026-09-11T16:00:00.000Z'), '2026-09-12');
  assert.throws(() => fieldToday('invalid'), /操作时间无效/);
});

test('本线线长和主管可操作，跨线、查看岗位、未知岗位与结案任务不可写', () => {
  const state = freeze(createFieldState());
  assert.equal(canOperateField(state, 'line-a-owner', 'task-active'), true); assert.equal(canOperateField(state, 'supervisor-a', 'task-pending'), true);
  for (const actorId of ['line-b-owner', 'viewer-a', 'missing']) { assert.equal(canOperateField(state, actorId, 'task-active'), false); assert.ok(errors(state, report({ actorId })).actorId); }
  assert.equal(canOperateField(state, 'supervisor-a', 'task-closed'), false); assert.equal(canOperateField(state, 'line-a-owner', 'missing'), false);
  for (const action of [report(), defect(), returned(), sign(), draft()]) assert.throws(() => act(state, { ...action, taskId: 'task-closed', actorId: 'supervisor-a' }), /结案/);
});

test('接收派工要求已发布资料和人工核对，接收仅记录责任与时间且不能重复', () => {
  const state = freeze(createFieldState());
  assert.ok(errors(state, accept({ reviewed: false })).reviewed); assert.ok(errors(state, accept({ taskId: 'task-doc-pending', actorId: 'line-a-owner' })).documents);
  const next = act(state, accept()); assert.equal(task(next, 'task-pending').acceptedBy, 'line-b-owner'); assert.equal(task(next, 'task-pending').acceptedAt, now);
  assert.deepEqual(next.reports, state.reports); assert.deepEqual(next.issues, state.issues);
  assert.throws(() => act(next, accept()), /已接收/); assert.throws(() => act(state, accept({ taskId: 'task-active', actorId: 'line-a-owner' })), /已接收/);
});

test('未接收任务不能签收、报工、存草稿、登记不良或申请退料', () => {
  const state = createFieldState();
  for (const action of [report(), defect(), returned(), sign(), draft()]) {
    const input = { ...action, taskId: 'task-pending', actorId: 'line-b-owner' };
    assert.match(errors(state, input)._form, /先接收派工/); assert.throws(() => act(state, input), /先接收派工/);
  }
});

test('B 线演示任务支持当日接收、签收、报工的完整流程且不改 A 线记录', () => {
  const original = freeze(createFieldState()); let next = act(original, accept());
  assert.equal(task(next, 'task-pending').date, today); assert.equal(task(next, 'task-pending').code, 'TASK-0911-002');
  next = act(next, sign({ taskId: 'task-pending', actorId: 'line-b-owner', issueId: 'issue-b-pending' }));
  next = act(next, report({ taskId: 'task-pending', actorId: 'line-b-owner', actual: 40, good: 40, bad: 0 }));
  assert.deepEqual(getFieldProgress(next, 'task-pending'), { reported: 40, good: 40, bad: 0, unreported: 0, unregisteredBad: 0, registeredBad: 0 });
  assert.deepEqual(getFieldProgress(next, 'task-active'), getFieldProgress(original, 'task-active'));
});

test('领料整张签收一次且保留原数量与批次码，不影响报工和其他领料', () => {
  const original = freeze(createFieldState()); assert.ok(errors(original, sign({ reviewed: false })).reviewed);
  const next = act(original, sign()); const issue = next.issues.find((item) => item.id === 'issue-shell-pending');
  assert.equal(issue.quantity, 20); assert.equal(issue.lotCode, null); assert.equal(issue.signedAt, now); assert.equal(issue.signedBy, 'line-a-owner');
  assert.deepEqual(next.reports, original.reports); assert.deepEqual(next.issues[0], original.issues[0]); assert.equal(getReturnable(next, issue.id), 20);
  assert.throws(() => act(next, sign()), /已签收/); assert.ok(errors(original, sign({ issueId: 'issue-b-pending' })).issueId);
});

test('报工增加数量一次，不要求所有领料签收，现场良品不改变计划或正式完工事实', () => {
  const original = freeze(createFieldState()); const next = act(original, report());
  assert.deepEqual(getFieldProgress(next, 'task-active'), { reported: 50, good: 44, bad: 6, unreported: 10, unregisteredBad: 4, registeredBad: 2 });
  assert.deepEqual(next.tasks, original.tasks); assert.deepEqual(next.issues, original.issues); assert.deepEqual(next.defects, original.defects);
  assert.equal(next.reports.at(-1).actual, 10); assert.equal(next.reports.at(-1).date, today); assert.equal(next.events.at(-1).kind, 'report');
});

test('报工须整数、正实际量、非负良不良且两者和等于实际量，不超计划剩余', () => {
  const state = createFieldState();
  for (const actual of [0, -1, 1.5, NaN, Infinity, '10', null]) assert.ok(errors(state, report({ actual })).actual);
  for (const field of ['good', 'bad']) for (const value of [-1, 0.5, NaN, Infinity, '1']) assert.ok(errors(state, report({ [field]: value }))[field]);
  assert.ok(errors(state, report({ actual: 21, good: 20, bad: 1 })).actual); assert.ok(errors(state, report({ good: 7 })).actual);
  assert.deepEqual(errors(state, report({ actual: 20, good: 0, bad: 20 })), {}); assert.deepEqual(errors(state, report({ actual: 20, good: 20, bad: 0 })), {});
  assert.equal(getFieldProgress(act(state, report({ actual: 20, good: 20, bad: 0 })), 'task-active').unreported, 0);
});

test('实际日期不能未来或早于任务，仅主管可以补录过去日期', () => {
  const state = createFieldState();
  for (const date of ['2026-02-30', '2026-9-11', '', '2026-09-12', '2026-09-10']) assert.ok(errors(state, report({ date })).date);
  assert.match(errors(state, report(), '2026-09-12').date, /主管补录/);
  assert.deepEqual(errors(state, report({ actorId: 'supervisor-a' }), '2026-09-12'), {});
  const next = act(state, report({ actorId: 'supervisor-a' }), '2026-09-12T01:00:00.000Z'); assert.equal(next.reports.at(-1).date, '2026-09-11');
  assert.ok(errors(state, report({ actorId: 'supervisor-a', date: '2026-09-10' }), '2026-09-12').date);
});

test('接收和报工都复核 BOM/SOP/SIP 发布状态，签收不伪装资料发布', () => {
  for (const prefix of ['BOM', 'SOP', 'SIP']) {
    const state = createFieldState(); task(state).documents.find((doc) => doc.code.startsWith(prefix)).status = 'pending';
    assert.match(errors(state, report()).documents, new RegExp(prefix));
    const accepted = task(state).acceptedAt; delete task(state).acceptedAt;
    assert.match(errors(state, accept({ ...base })).documents, new RegExp(prefix)); task(state).acceptedAt = accepted;
  }
});

test('不良登记从指定报工的不良池扣取，可分次登记但不能重复累加报工', () => {
  const original = freeze(createFieldState()); let next = act(original, defect({ quantity: 1 }));
  assert.equal(getReportUnregistered(next, 'report-seed'), 1); next = act(next, defect({ quantity: 1 }));
  assert.deepEqual(getFieldProgress(next, 'task-active'), { reported: 40, good: 36, bad: 4, unreported: 20, unregisteredBad: 0, registeredBad: 4 });
  assert.deepEqual(next.reports, original.reports); assert.equal(next.defects.length, 3);
  assert.throws(() => act(next, defect({ quantity: 1 })), /仅剩 0/);
  assert.ok(errors(original, defect({ reportId: 'report-closed' })).reportId); assert.ok(errors(original, defect({ quantity: 3 })).quantity);
});

test('不良只能关联同任务已签收来源，无批次码或无来源仍可保存待补齐', () => {
  const state = createFieldState();
  for (const issueId of ['issue-shell-pending', 'issue-b-pending', 'missing', undefined]) assert.ok(errors(state, defect({ issueId })).issueId);
  const known = act(state, defect()); assert.equal(known.defects.at(-1).missingLot, false); assert.equal(known.issues[0].lotCode, 'PCB-260910-D');
  const unknown = act(state, defect({ issueId: null })); assert.equal(unknown.defects.at(-1).missingLot, true); assert.equal(unknown.defects.at(-1).issueId, null);
  const signed = act(state, sign()); const missing = act(signed, defect({ issueId: 'issue-shell-pending' })); assert.equal(missing.defects.at(-1).missingLot, true);
});

test('不良现象和正整数数量校验，仅其他现象必填描述，照片可不附', () => {
  const state = createFieldState();
  for (const quantity of [0, -1, 0.5, NaN, Infinity, '1']) assert.ok(errors(state, defect({ quantity })).quantity);
  assert.ok(errors(state, defect({ phenomenon: 'unknown' })).phenomenon); assert.ok(errors(state, defect({ phenomenon: '其他', description: '' })).description);
  assert.deepEqual(errors(state, defect({ description: '' })), {});
  assert.ok(errors(state, defect({ description: 'x'.repeat(2001) })).description); assert.deepEqual(errors(state, defect({ photos: [] })), {});
});

test('照片接受 PNG/JPEG 且深度克隆，最多 3 张、10MB、前缀与大小须一致', () => {
  const state = freeze(createFieldState()); const photos = [photo(), photo({ id: 'photo-2', type: 'image/jpeg', name: '现场.jpg', dataUrl: 'data:image/jpeg;base64,AA==' })];
  const next = act(state, defect({ photos })); photos[0].dataUrl = 'changed';
  assert.equal(next.defects.at(-1).photos[0].dataUrl, 'data:image/png;base64,AA==');
  const invalid = [Array(4).fill(photo()), [photo(), photo()], [photo({ type: 'image/gif' })], [photo({ size: 10 * 1024 * 1024 + 1 })], [photo({ size: 0 })], [photo({ size: 2 })], [photo({ dataUrl: 'data:image/jpeg;base64,AA==' })], [photo({ dataUrl: 'data:image/png;base64,@@' })], [photo({ dataUrl: 'https://example.com/photo.png' })], null];
  for (const photos of invalid) assert.ok(errors(state, defect({ photos })).photos);
});

test('退料须签收、人工确认现场未用余料，累计申请不能超过签收量', () => {
  const state = freeze(createFieldState()); assert.ok(errors(state, returned({ reviewed: false })).reviewed);
  for (const issueId of ['issue-shell-pending', 'issue-b-pending', 'missing']) assert.ok(errors(state, returned({ issueId })).issueId);
  const first = act(state, returned({ quantity: 30 })); const next = act(first, returned({ quantity: 10 }));
  assert.equal(getReturnable(next, 'issue-main-signed'), 0); assert.equal(next.returns.length, 2); assert.equal(next.returns.at(-1).status, 'requested');
  assert.throws(() => act(next, returned({ quantity: 1 })), /最多还可申请 0/);
  assert.deepEqual(next.issues, state.issues); assert.deepEqual(next.reports, state.reports); assert.deepEqual(next.tasks, state.tasks);
});

test('退料只按申请上限核对，不把报工数当作 BOM 实耗，并支持三位小数', () => {
  const state = createFieldState(); assert.equal(getReturnable(state, 'issue-main-signed'), 40, '已报工40不等于推定消耗了40主控板');
  const next = act(state, returned({ quantity: 0.125 })); assert.equal(getReturnable(next, 'issue-main-signed'), 39.875);
  for (const quantity of [0, -1, NaN, Infinity, 0.0001, '1', 41]) assert.ok(errors(state, returned({ quantity })).quantity);
  assert.ok(errors(state, returned({ reason: '' })).reason);
});

test('个人草稿允许空值和未填完文本，不计报工、不改现存报工，按岗位与任务隔离', () => {
  const original = freeze(createFieldState()); const input = freeze(draft()); let next = act(original, input);
  assert.deepEqual(next.drafts['line-a-owner:task-active'], input.draft); assert.deepEqual(getFieldProgress(next, 'task-active'), getFieldProgress(original, 'task-active'));
  next = act(next, draft({ actorId: 'supervisor-a', draft: { date: 'invalid', actual: '', good: '-', bad: '', note: '' } }));
  assert.equal(Object.keys(next.drafts).length, 2); assert.equal(next.drafts['line-a-owner:task-active'].actual, '1.');
  assert.deepEqual(next.reports, original.reports); assert.equal(original.drafts['line-a-owner:task-active'], undefined);
});

test('报工成功只删除当前岗位当前任务草稿，失败保留填写内容', () => {
  let state = act(createFieldState(), draft()); state = act(state, draft({ actorId: 'supervisor-a' }));
  const failed = freeze(state); assert.throws(() => act(failed, report({ actual: 100, good: 98, bad: 2 })), /最多可报/);
  assert.equal(failed.drafts['line-a-owner:task-active'].actual, '1.');
  const next = act(state, report()); assert.equal(next.drafts['line-a-owner:task-active'], undefined); assert.ok(next.drafts['supervisor-a:task-active']);
});

test('草稿仅接收受限文本字段，拒绝过长、数值和非对象并忽略额外字段', () => {
  const state = createFieldState();
  for (const [key, value] of [['date', 'x'.repeat(33)], ['actual', 'x'.repeat(33)], ['note', 'x'.repeat(1001)], ['good', 1]]) assert.ok(errors(state, draft({ draft: { ...draft().draft, [key]: value } }))[key]);
  assert.ok(errors(state, draft({ draft: null })).draft);
  const next = act(state, draft({ draft: { ...draft().draft, extra: { unsupported: 'value' } } })); assert.equal(next.drafts['line-a-owner:task-active'].extra, undefined);
});

test('所有失败均不部分变更，旧版本、重复提交、无效时间及未知操作被拒绝', () => {
  const state = freeze(createFieldState()); const before = JSON.stringify(state);
  for (const version of [0, 2, 1.5, NaN, '1']) assert.throws(() => act(state, report(), now, version), /数据已变化/);
  assert.throws(() => act(state, report(), 'invalid'), /操作时间无效/); assert.throws(() => act(state, { ...base, kind: 'delete' }), /不支持/);
  const next = act(state, report()); assert.throws(() => act(next, report(), now, 1), /数据已变化/);
  assert.ok(errors(state, null)._form); assert.ok(errors(state, report({ taskId: 'missing' })).taskId); assert.ok(errors(state, report(), 'invalid')._form);
  assert.equal(JSON.stringify(state), before);
});

test('历史报工与登记均保留不可变证据，新增事件编号不碰撞已有记录', () => {
  const state = createFieldState(); state.events[0].id = 'field-event-2';
  const next = act(state, defect()); assert.equal(next.events.at(-1).id, 'field-event-2-1'); assert.deepEqual(next.defects[0], state.defects[0]);
  next.defects[0].description = 'changed'; assert.notEqual(state.defects[0].description, 'changed');
  assert.equal(next.events.at(-1).kind, 'defect'); assert.ok(next.events.at(-1).summary.includes('未重复增加'));
});

test('CSV包含任务、发布资料、报工、不良、领退料、草稿与操作历史，照片仅列元数据', () => {
  let state = act(createFieldState(), defect({ photos: [photo()] })); state = act(state, returned()); state = act(state, draft());
  const csv = buildFieldCsv(freeze(state), 'task-active'); const rows = parseCsv(csv); assert.equal(csv.charCodeAt(0), 0xFEFF); assert.ok(rows.every((row) => row.length === 4));
  for (const section of ['现场任务', '资料摘要', '现场报工', '不良登记', '领料与签收', '退料申请', '个人报工草稿（未计入报工）', '操作记录']) assert.ok(rows.some((row) => row[0] === section), section);
  for (const value of ['TASK-0911-001', 'DISPATCH-0911-001', 'PCB-260910-D', 'REPORT-0911-001', 'BOM-CONTROL', 'SOP-CONTROL', 'SIP-CONTROL', '现场.png', 'image/png']) assert.ok(rows.some((row) => row[3] === value), value);
  assert.equal(csv.includes('data:image/png;base64'), false); assert.ok(csv.includes('不包含图片文件')); assert.ok(csv.includes('不回写 P01'));
});

test('CSV保持中文、引号与换行，保护公式注入并严格限定当前任务', () => {
  const state = createFieldState(); state.reports[0].note = '中文,"备注"\n下一行';
  assert.ok(parseCsv(buildFieldCsv(state, 'task-active')).some((row) => row[3] === '中文,"备注"\n下一行'));
  for (const value of ['=1+1', '+SUM(A1)', '-1+1', '@SUM(A1)', '  =1+1', '\t=1+1', '\u0000@SUM(A1)', '\uFEFF=1+1', '\ttext']) {
    state.reports[0].note = value; const row = parseCsv(buildFieldCsv(state, 'task-active')).find((item) => item[0] === '现场报工' && item[1] === 'REPORT-0911-001' && item[2] === '说明'); assert.equal(row[3], `'${value}`);
  }
  const before = JSON.stringify(state); const csv = buildFieldCsv(state, 'task-active'); assert.equal(csv.includes('REPORT-0907-002'), false); assert.equal(csv.includes('ISS-0911-PREVIEW'), false); assert.equal(JSON.stringify(state), before);
  assert.throws(() => buildFieldCsv(state, 'missing'), /任务已不存在/);
});
