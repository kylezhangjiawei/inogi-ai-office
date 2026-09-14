import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
const source = readFileSync(new URL('../src/app/production/defects/defectModel.ts', import.meta.url), 'utf8');
const code = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
const forbidden = () => { throw new Error('不良预览不能访问真实接口或持久化'); }; const storage = new Proxy({}, { get: forbidden, set: forbidden }); const model = {};
new Function('exports', 'fetch', 'localStorage', 'sessionStorage', 'indexedDB', code)(model, forbidden, storage, storage, storage);
const { createDefectState, defectToday, canOperateDefect, getDefectOwners, getDefectProgress, getHandoffAvailable, validateDefectAction, applyDefectAction, buildDefectCsv, getDefectRanking } = model;
const today = '2026-09-14'; const now = '2026-09-14T05:00:00.000Z';
const issue = (state, id = 'issue-final') => state.issues.find((item) => item.id === id);
const progress = (state, id = 'issue-final') => getDefectProgress(state, id);
const act = (state, action, version = state.version, time = now) => applyDefectAction(state, version, action, time);
const errors = (state, action, day = today) => validateDefectAction(state, action, day);
const assign = (patch = {}) => ({ kind: 'assign', actorId: 'quality-a', issueId: 'issue-process', ownerId: 'line-b', dueDate: '2026-09-16', priority: 'high', reason: '先核对装配干涉范围', reviewed: true, ...patch });
const route = (patch = {}) => ({ kind: 'route', actorId: 'quality-a', issueId: 'issue-process', direction: 'rd', ownerId: 'rd-a', dueDate: '2026-09-16', description: '请核对图纸尺寸与现场装配情况', causeStatus: 'pending', cause: '', reviewed: true, ...patch });
const repair = (patch = {}) => ({ kind: 'repair', actorId: 'line-a', issueId: 'issue-field', date: today, quantity: 1, description: '按整改作业说明处理划伤', basis: '现场整改作业说明摘要', photos: [], reviewed: true, ...patch });
const handoff = (patch = {}) => ({ kind: 'handoff', actorId: 'line-a', issueId: 'issue-final', repairId: 'repair-ready', quantity: 2, reviewed: true, ...patch });
const close = (patch = {}) => ({ kind: 'close', actorId: 'quality-a', issueId: 'issue-verified', summary: '已核对全部 QC 合格回执和问题范围', reviewed: true, ...patch });
const photo = (patch = {}) => ({ id: 'photo-1', name: '整改.png', type: 'image/png', size: 1, dataUrl: 'data:image/png;base64,AA==', ...patch });
const freeze = (value) => { Object.freeze(value); for (const entry of Object.values(value)) if (entry && typeof entry === 'object' && !Object.isFrozen(entry)) freeze(entry); return value; };
function parseCsv(csv) { const rows = []; let row = []; let field = ''; let quoted = false; const text = csv.replace(/^\uFEFF/, ''); for (let i = 0; i < text.length; i++) { const char = text[i]; if (quoted) { if (char === '"' && text[i + 1] === '"') { field += '"'; i++; } else if (char === '"') quoted = false; else field += char; } else if (char === '"') quoted = true; else if (char === ',') { row.push(field); field = ''; } else if (char === '\r' && text[i + 1] === '\n') { row.push(field); rows.push(row); row = []; field = ''; i++; } else field += char; } return rows; }

test('初始数量池按原不良追踪，整改不直接记为已解决', () => {
  const state = createDefectState();
  assert.deepEqual(progress(state), { resolved: 0, pendingReinspection: 0, ready: 2, remaining: 3, availableToRepair: 1, repaired: 2 });
  assert.deepEqual(progress(state, 'issue-retest-failed'), { resolved: 2, pendingReinspection: 0, ready: 0, remaining: 1, availableToRepair: 1, repaired: 3 });
  assert.equal(getHandoffAvailable(state, 'repair-ready'), 2); assert.equal(getHandoffAvailable(state, 'repair-verified'), 0); assert.equal(getHandoffAvailable(state, 'missing'), 0);
});

test('P02/P03独立来源编号、数量、单位、历史SIP和档案关联保持', () => {
  const state = createDefectState(); const historical = issue(state, 'issue-verified');
  assert.equal(issue(state).sourceRecordId, 'record-initial'); assert.equal(issue(state).sourceCode, 'QC-0911-001'); assert.equal(issue(state).quantity, 3);
  assert.equal(issue(state, 'issue-process').quantity, 6); assert.equal(issue(state, 'issue-process').unit, '件');
  assert.equal(issue(state, 'issue-field').quantity, 2); assert.equal(issue(state, 'issue-field').unit, '件'); assert.equal(issue(state, 'issue-field').sourceCode, 'DEFECT-0911-001'); assert.equal(issue(state, 'issue-field').phenomenon, '功能异常'); assert.match(issue(state, 'issue-field').description, /通信测试间歇断连/);
  assert.equal(historical.archiveId, 'batch-02'); assert.equal(historical.sourceRecordId, 'record-history-initial'); assert.equal(historical.closedAt, undefined);
  assert.equal(state.receipts.find((item) => item.issueId === historical.id).sipVersion, 'C'); assert.equal(progress(state, historical.id).resolved, 6);
  assert.equal(new Set(state.issues.map((item) => item.sourceKey)).size, state.issues.length);
});

test('每次创建状态互不共享，业务日期按上海自然日', () => {
  const a = createDefectState(); const b = createDefectState(); a.issues[0].quantity = 100; a.receipts[0].sipVersion = 'changed';
  assert.equal(b.issues[0].quantity, 3); assert.equal(b.receipts[0].sipVersion, 'C');
  assert.equal(defectToday('2026-09-14T15:59:59.000Z'), '2026-09-14'); assert.equal(defectToday('2026-09-14T16:00:00.000Z'), '2026-09-15'); assert.throws(() => defectToday('invalid'), /操作时间/);
});

test('责任人候选由方向和同线职责约束，QC和查看岗不可指派', () => {
  const state = createDefectState();
  assert.deepEqual(getDefectOwners(state, 'issue-final').map((item) => item.id), ['quality-a', 'line-a']);
  assert.deepEqual(getDefectOwners(state, 'issue-process').map((item) => item.id), ['quality-a', 'line-b', 'rd-a', 'procurement-a']);
  assert.deepEqual(getDefectOwners(state, 'issue-process', 'rd').map((item) => item.id), ['rd-a']);
  assert.deepEqual(getDefectOwners(state, 'issue-process', 'procurement').map((item) => item.id), ['procurement-a']);
  assert.deepEqual(getDefectOwners(state, 'missing'), []);
  for (const ownerId of ['qc-a', 'viewer-a', 'line-a', 'missing']) assert.ok(errors(state, assign({ ownerId })).ownerId);
});

test('仅责任人处理本问题，跨产线、QC与查看岗无法写入', () => {
  const state = createDefectState();
  assert.equal(canOperateDefect(state, 'line-a', 'issue-field', 'repair'), true);
  for (const actorId of ['line-b', 'rd-a', 'procurement-a', 'qc-a', 'viewer-a', 'missing']) { assert.equal(canOperateDefect(state, actorId, 'issue-field'), false); assert.ok(errors(state, repair({ actorId })).actorId); }
  issue(state, 'issue-field').ownerId = 'line-b'; assert.equal(canOperateDefect(state, 'line-b', 'issue-field'), false, '即使错误指派跨线，仍无操作权限');
  assert.equal(canOperateDefect(state, 'quality-a', 'issue-field', 'repair'), true); assert.equal(canOperateDefect(state, 'quality-a', 'missing'), false);
});

test('指派和关闭仅质量管理，已关闭问题所有动作只读', () => {
  const state = createDefectState();
  for (const actorId of ['line-a', 'line-b', 'rd-a', 'procurement-a', 'qc-a', 'viewer-a']) { assert.ok(errors(state, assign({ actorId })).actorId); assert.ok(errors(state, close({ actorId })).actorId); }
  for (const action of [assign(), route(), repair(), handoff(), close()]) { assert.equal(canOperateDefect(state, 'quality-a', 'issue-closed', action.kind), false); assert.throws(() => act(state, { ...action, actorId: 'quality-a', issueId: 'issue-closed' }), /已关闭/); }
});

test('指派保存责任人优先级期限与操作记录，不改变原来源或数量', () => {
  const state = freeze(createDefectState()); const next = act(state, assign()); const selected = issue(next, 'issue-process');
  assert.equal(selected.ownerId, 'line-b'); assert.equal(selected.priority, 'high'); assert.equal(selected.dueDate, '2026-09-16'); assert.equal(selected.direction, 'pending');
  assert.equal(selected.sourceKey, issue(state, selected.id).sourceKey); assert.equal(selected.quantity, 6); assert.deepEqual(next.receipts, state.receipts);
  assert.equal(next.version, 2); assert.equal(next.events.at(-1).kind, 'assign'); assert.match(next.events.at(-1).summary, /装配干涉/);
});

test('日期必须真实且新期限不早于今天，整改不能早于发生日期或晚于今天', () => {
  const state = createDefectState();
  for (const dueDate of ['', '2026-02-30', '2026-9-14', '2026-09-13']) { assert.ok(errors(state, assign({ dueDate })).dueDate); assert.ok(errors(state, route({ dueDate })).dueDate); }
  for (const date of ['', '2026-02-30', '2026-9-14', '2026-09-10', '2026-09-15']) assert.ok(errors(state, repair({ date })).date);
  assert.deepEqual(errors(state, repair({ date: '2026-09-11' })), {}); assert.deepEqual(errors(state, assign({ dueDate: today })), {});
  assert.ok(errors(state, repair(), 'invalid')._form);
});

test('原因待确认允许协同，但不把现象伪装为已确认根因', () => {
  const state = createDefectState(); const next = act(state, route()); const selected = issue(next, 'issue-process');
  assert.equal(selected.direction, 'rd'); assert.equal(selected.causeStatus, 'pending'); assert.equal(selected.cause, ''); assert.equal(next.collaborations.length, 1);
  assert.ok(errors(state, route({ cause: '装配干涉' })).cause); assert.ok(errors(state, route({ causeStatus: 'confirmed', cause: ' ' })).cause);
  assert.ok(errors(state, route({ causeStatus: 'guessed' })).causeStatus);
  const confirmed = act(state, route({ causeStatus: 'confirmed', cause: '  孔位公差累积超限  ' })); assert.equal(issue(confirmed, 'issue-process').cause, '孔位公差累积超限');
});

test('协同方向匹配岗位，同方向修订复用任务编号并保留历史', () => {
  const state = createDefectState();
  assert.ok(errors(state, route({ ownerId: 'line-b' })).ownerId); assert.ok(errors(state, route({ direction: 'procurement', ownerId: 'rd-a' })).ownerId); assert.ok(errors(state, route({ direction: 'unknown' })).direction);
  let next = act(state, route()); const firstCode = next.collaborations[0].code;
  next = act(next, route({ actorId: 'rd-a', description: '补充尺寸测量记录，请会同现场核对' }));
  assert.equal(next.collaborations.length, 1); assert.equal(next.collaborations[0].code, firstCode); assert.match(next.collaborations[0].description, /尺寸测量/); assert.equal(next.events.filter((item) => item.issueId === 'issue-process').length, 2);
  assert.equal(canOperateDefect(next, 'rd-a', 'issue-process', 'route'), true); assert.equal(canOperateDefect(next, 'rd-a', 'issue-process', 'repair'), false);
});

test('待交接或待QC数量存在时不能换方向，同方向可补充调查说明', () => {
  const state = createDefectState();
  assert.match(errors(state, route({ issueId: 'issue-final' })).direction, /待交接/);
  const same = route({ issueId: 'issue-final', direction: 'onsite', ownerId: 'line-a' }); assert.deepEqual(errors(state, same), {});
  const sent = act(state, handoff()); assert.match(errors(sent, route({ issueId: 'issue-final' })).direction, /待 QC/);
  assert.equal(issue(act(sent, same)).direction, 'onsite');
});

test('整改只占用当前未处置池，保存实际措施和证据快照', () => {
  const state = freeze(createDefectState()); const input = repair({ description: '  修整外观划伤  ', photos: [photo()] }); const next = act(state, input);
  const record = next.repairs.at(-1); assert.equal(record.description, '修整外观划伤'); assert.equal(record.quantity, 1); assert.equal(record.basis, input.basis);
  assert.equal(progress(next, 'issue-field').ready, 1); assert.equal(progress(next, 'issue-field').remaining, 2); assert.equal(progress(next, 'issue-field').availableToRepair, 1);
  assert.deepEqual(next.receipts, state.receipts); assert.deepEqual(next.issues, state.issues); input.photos[0].name = 'changed'; assert.equal(record.photos[0].name, '整改.png');
});

test('整改和交接数量必须正安全整数，禁止超量或重复占用', () => {
  const state = createDefectState();
  for (const quantity of [0, -1, 0.5, NaN, Infinity, '1', null, Number.MAX_SAFE_INTEGER + 1]) { assert.ok(errors(state, repair({ quantity })).quantity); assert.ok(errors(state, handoff({ quantity })).quantity); }
  assert.ok(errors(state, repair({ quantity: 3 })).quantity); assert.ok(errors(state, repair({ issueId: 'issue-final', quantity: 2 })).quantity);
  const next = act(state, repair({ quantity: 2 })); assert.equal(progress(next, 'issue-field').availableToRepair, 0); assert.throws(() => act(next, repair()), /剩 0/);
});

test('复验交接必须引用本问题整改来源，分批余额独立且不会创建QC结果', () => {
  const state = freeze(createDefectState());
  assert.ok(errors(state, handoff({ repairId: 'repair-verified' })).repairId); assert.ok(errors(state, handoff({ repairId: 'missing' })).repairId);
  const first = act(state, handoff({ quantity: 1 })); assert.equal(getHandoffAvailable(first, 'repair-ready'), 1); assert.equal(progress(first).ready, 1); assert.equal(progress(first).pendingReinspection, 1);
  const next = act(first, handoff({ quantity: 1 })); assert.equal(getHandoffAvailable(next, 'repair-ready'), 0); assert.equal(progress(next).pendingReinspection, 2); assert.equal(progress(next).remaining, 3);
  assert.deepEqual(next.receipts, state.receipts); assert.deepEqual(next.issues, state.issues); assert.throws(() => act(next, handoff({ quantity: 1 })), /剩 0/);
});

test('复验失败重新释放未解决数量，多轮整改累计可超过原不良但不能重复解决', () => {
  const original = createDefectState(); const id = 'issue-retest-failed';
  let state = act(original, repair({ issueId: id })); const second = state.repairs.at(-1);
  assert.equal(progress(state, id).repaired, 4); assert.equal(progress(state, id).ready, 1); assert.equal(progress(state, id).availableToRepair, 0); assert.equal(issue(state, id).quantity, 3);
  state = act(state, handoff({ issueId: id, repairId: second.id, quantity: 1 })); assert.equal(progress(state, id).pendingReinspection, 1); assert.equal(progress(state, id).resolved, 2);
  assert.ok(errors(state, close({ issueId: id }))._form);
  // A later immutable source snapshot supplied by P03; P08 offers no QC receipt action.
  const received = structuredClone(state); received.receipts.push({ id: 'receipt-round-two', code: 'RETEST-ROUND-TWO', issueId: id, handoffId: received.handoffs.at(-1).id, quantity: 1, good: 1, bad: 0, inspector: 'QC 检验员', date: today, evidence: '原问题剩余 1 台按 SIP 复验合格摘要', sipVersion: 'V1.0' });
  assert.deepEqual(progress(received, id), { resolved: 3, pendingReinspection: 0, ready: 0, remaining: 0, availableToRepair: 0, repaired: 4 });
  const closed = act(received, close({ issueId: id })); assert.equal(issue(closed, id).closedAt, now); assert.deepEqual(closed.receipts[1], original.receipts[1]); assert.equal(closed.issues.length, original.issues.length);
});

test('关闭要求全部来源QC合格，不能以已整改、已交接或部分合格替代', () => {
  const state = createDefectState(); for (const issueId of ['issue-final', 'issue-field', 'issue-process', 'issue-retest-failed']) assert.ok(errors(state, close({ issueId }))._form);
  const sent = act(state, handoff()); assert.ok(errors(sent, close({ issueId: 'issue-final' }))._form);
  const next = act(freeze(state), close()); assert.equal(issue(next, 'issue-verified').closedBy, 'quality-a'); assert.equal(issue(next, 'issue-verified').closedAt, now);
  assert.deepEqual(next.receipts, state.receipts); assert.deepEqual(next.handoffs, state.handoffs); assert.equal(progress(next, 'issue-verified').resolved, 6); assert.match(next.events.at(-1).summary, /未产生 QA 放行或实际出货/);
});

test('QC回执缺来源、重复、超量、量和错误或缺检验依据均不能关闭', () => {
  for (const patch of [{ handoffId: 'missing' }, { quantity: 7, good: 7 }, { good: 7 }, { evidence: '' }, { sipVersion: '' }, { inspector: '' }, { date: '2026-09-06' }]) {
    const state = createDefectState(); Object.assign(state.receipts[0], patch); assert.ok(errors(state, close())._form); assert.throws(() => act(state, close()));
  }
  const duplicated = createDefectState(); duplicated.receipts.push({ ...duplicated.receipts[0] }); assert.ok(errors(duplicated, close())._form);
  const foreign = createDefectState(); foreign.handoffs[0].repairId = 'repair-ready'; assert.ok(errors(foreign, close())._form);
});

test('损坏整改/交接来源无法继续消费数量池', () => {
  for (const patch of [{ quantity: 0 }, { quantity: -1 }, { basis: '' }, { date: 'invalid' }]) {
    const state = createDefectState(); Object.assign(state.repairs[0], patch); assert.ok(errors(state, handoff())._form);
  }
  const state = createDefectState(); state.handoffs.push({ id: 'invalid-handoff', code: 'invalid', issueId: 'issue-final', repairId: 'repair-ready', quantity: 3, actorId: 'line-a', at: now }); assert.ok(errors(state, repair({ issueId: 'issue-final' }))._form);
});

test('所有写入需人工复核，必填说明与长度限制生效', () => {
  const state = createDefectState(); for (const action of [assign(), route(), repair(), handoff(), close()]) assert.ok(errors(state, { ...action, reviewed: false }).reviewed);
  for (const [action, field] of [[assign(), 'reason'], [route(), 'description'], [repair(), 'description'], [repair(), 'basis'], [close(), 'summary']]) { for (const value of ['', null, 'x'.repeat(2001)]) assert.ok(errors(state, { ...action, [field]: value })[field]); }
  assert.ok(errors(state, assign({ priority: 'urgent' })).priority);
});

test('照片接受精确PNG/JPEG字节和最多3张，拒绝无效内容或伪造大小', () => {
  const state = createDefectState(); const valid = [photo(), photo({ id: 'photo-2', type: 'image/jpeg', dataUrl: 'data:image/jpeg;base64,AAA=', size: 2 }), photo({ id: 'photo-3', dataUrl: 'data:image/png;base64,AAAA', size: 3 })];
  assert.deepEqual(errors(state, repair({ photos: valid })), {});
  for (const photos of [null, [...valid, photo({ id: 'photo-4' })], [photo(), photo()], [photo({ type: 'image/svg+xml' })], [photo({ size: 2 })], [photo({ size: 10 * 1024 * 1024 + 1 })], [photo({ dataUrl: 'data:image/png;base64,broken!' })], [photo({ dataUrl: 'data:image/jpeg;base64,AA==' })], [photo({ name: '' })], [photo({ id: '' })]]) assert.ok(errors(state, repair({ photos })).photos);
});

test('版本与上下文失败保持原状态，合法写入只生成唯一新记录', () => {
  const state = freeze(createDefectState()); const before = JSON.stringify(state);
  for (const version of [0, 2, '1', NaN]) assert.throws(() => act(state, repair(), version), /已变化/);
  assert.throws(() => act(state, repair({ issueId: 'missing' })), /有效不良/); assert.throws(() => act(state, repair(), 1, 'invalid'), /操作时间/);
  assert.equal(JSON.stringify(state), before);
  const next = act(state, repair()); assert.equal(new Set([...next.repairs, ...next.events].map((item) => item.id)).size, next.repairs.length + next.events.length);
  assert.throws(() => act(next, repair(), 1), /已变化/);
});

test('不支持创建QC结果或重复登记不良的操作，拒绝畸形提交', () => {
  const state = createDefectState();
  for (const action of [null, undefined, {}, { kind: 'receipt', actorId: 'qc-a', issueId: 'issue-final', quantity: 3, good: 3 }, { kind: 'create', sourceKey: 'p03:record-initial' }]) assert.ok(errors(state, action)._form);
  const injected = act(state, handoff({ good: 2, bad: 0, qaReleased: true })); assert.deepEqual(injected.receipts, state.receipts); assert.equal(issue(injected).closedAt, undefined);
});

test('近30天排名只使用明确历史样本，来源去重不按数量或常用词计数', () => {
  const state = createDefectState();
  assert.deepEqual(getDefectRanking(state, 'line-a', today), [{ phenomenon: '功能异常', count: 3 }, { phenomenon: '装配干涉', count: 1 }]);
  assert.equal(getDefectRanking(state, 'all', today).find((item) => item.phenomenon === '装配干涉').count, 3);
  state.issues[0].quantity = 10000; assert.equal(getDefectRanking(state, 'line-a', today)[0].count, 3);
  state.samples = []; assert.deepEqual(getDefectRanking(state, 'all', today), [], '当前issues及初始常用词不冒充历史发生次数');
});

test('历史样本日期范围含今天与29天前，过滤未来过期和无效来源', () => {
  const state = createDefectState(); state.samples = [
    { id: 'one', sourceKey: 'one', date: '2026-08-16', lineId: 'line-a', phenomenon: '有效边界' },
    { id: 'two', sourceKey: 'two', date: today, lineId: 'line-a', phenomenon: '有效边界' },
    { id: 'old', sourceKey: 'old', date: '2026-08-15', lineId: 'line-a', phenomenon: '过期' },
    { id: 'future', sourceKey: 'future', date: '2026-09-15', lineId: 'line-a', phenomenon: '未来' },
    { id: 'invalid', sourceKey: 'invalid', date: '2026-02-30', lineId: 'line-a', phenomenon: '无效' },
    { id: 'missing', sourceKey: '', date: today, lineId: 'line-a', phenomenon: '无来源' },
    { id: 'other', sourceKey: 'other', date: today, lineId: 'line-b', phenomenon: '另线' },
  ];
  assert.deepEqual(getDefectRanking(state, 'line-a', today), [{ phenomenon: '有效边界', count: 2 }]); assert.deepEqual(getDefectRanking(state, 'all', 'invalid'), []); assert.deepEqual(getDefectRanking(state, 'unknown', today), []);
});

test('导出完整来源链和照片元数据，不泄漏其他问题或照片字节', () => {
  let state = act(createDefectState(), repair({ photos: [photo()], description: '返工说明,含逗号\n第二行"引号"' }));
  state = act(state, handoff({ issueId: 'issue-field', repairId: state.repairs.at(-1).id, quantity: 1 }));
  const csv = buildDefectCsv(state, 'issue-field'); const rows = parseCsv(csv);
  assert.ok(csv.startsWith('\uFEFF')); assert.ok(rows.every((row) => row.length === 4)); assert.ok(rows.some((row) => row[3] === '返工说明,含逗号\n第二行"引号"'));
  assert.match(csv, /DEFECT-0911-001/); assert.match(csv, /整改.png/); assert.match(csv, /待 QC 复验数量/); assert.match(csv, /复验交接/); assert.match(csv, /不代表跨 P02\/P03 物理全局去重/);
  assert.doesNotMatch(csv, /data:image\/png/); assert.doesNotMatch(csv, /AA==/); assert.doesNotMatch(csv, /FQC-0907-02/); assert.throws(() => buildDefectCsv(state, 'missing'), /不存在/);
});

test('导出对公式触发符、前导空白和控制字符进行中和', () => {
  for (const value of ['=SUM(1,2)', '+CMD', '-3+4', '@formula', '  =formula', '\tplain', '\nplain', '\u0001=BAD']) {
    const state = createDefectState(); issue(state).description = value; const rows = parseCsv(buildDefectCsv(state, 'issue-final')); const cell = rows.find((row) => row[0] === '不良问题' && row[2] === '说明')[3]; assert.equal(cell, `'${value}`);
  }
});
