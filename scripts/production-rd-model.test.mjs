import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
const read = (path) => readFileSync(new URL(`../src/app/production/${path}`, import.meta.url), 'utf8');
const noExternal = () => assert.fail('生产研发预览不得访问正式接口或持久化存储');
const noStorage = new Proxy({}, { get: noExternal, set: noExternal });
function load(path, imports = {}) {
  const exports = {};
  const code = ts.transpileModule(read(path), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  new Function('exports', 'require', 'fetch', 'localStorage', 'sessionStorage', 'indexedDB', code)(exports, (name) => { assert.ok(Object.hasOwn(imports, name), `审查依赖 ${name}`); return imports[name]; }, noExternal, noStorage, noStorage, noStorage);
  return exports;
}
const defectsModel = load('defects/defectModel.ts');
const model = load('rd-collaboration/rdModel.ts', { '../defects/defectModel': defectsModel });
const { createRdState, getRdCase, canOperateRd, getRdVerifiers, validateRdAction, applyRdAction } = model;
const today = '2026-09-14'; const now = `${today}T05:00:00.000Z`;
const fresh = () => ({ rd: createRdState(), defects: defectsModel.createDefectState() });
const record = (pair) => getRdCase(pair.rd, pair.defects, 'issue-process');
const issue = (pair) => pair.defects.issues.find((item) => item.id === 'issue-process');
const act = (pair, action, time = now) => applyRdAction(pair.rd, pair.defects, pair.rd.version, pair.defects.version, action, time);
const err = (pair, action) => validateRdAction(pair.rd, pair.defects, action, today);
const base = (kind, patch = {}) => ({ kind, issueId: 'issue-process', actorId: 'rd-a', reviewed: true, ...patch });
const assign = (patch = {}) => base('assign', { actorId: 'quality-a', ownerId: 'rd-a', dueDate: '2026-09-16', description: '请核对阀组件配合尺寸与图纸', ...patch });
const request = (patch = {}) => base('request-info', { request: '补充三处配合尺寸及量具编号', ...patch });
const provide = (patch = {}) => base('provide-info', { actorId: 'quality-a', response: '量具复核后补充三处尺寸', evidence: '测量记录 DEMO-MEASURE-1 摘要', ...patch });
const opinion = (patch = {}) => base('opinion', { text: '建议核对定位工装，再按规定装配间隙验证', basis: '图纸 V1.2 与演示测量记录摘要', drawingChange: 'no', drawingReference: '', sopChange: 'no', sopReference: '', ...patch });
const send = (patch = {}) => base('send-verification', { verifierId: 'line-b', plannedDate: today, ...patch });
const verify = (patch = {}) => base('verify', { actorId: 'line-b', date: today, result: 'passed', evidence: '现场验证 DEMO-FV-1 摘要', note: '按技术方案调整后，现场试装验证通过', ...patch });
const close = (patch = {}) => base('close', { actorId: 'quality-a', summary: '核对最新意见与现场验证，结束本次技术协同', ...patch });
const assigned = () => act(fresh(), assign());
const ready = () => act(assigned(), opinion());
const verifying = () => act(ready(), send());
const verified = () => act(verifying(), verify());
const freeze = (obj) => { Object.freeze(obj); for (const value of Object.values(obj)) if (value && typeof value === 'object' && !Object.isFrozen(value)) freeze(value); return obj; };

test('P04 尚未指派时直接引用原 P08 异常，不产生第二份不良或协同', () => {
  const pair = fresh(); assert.equal(record(pair), undefined); assert.equal(pair.rd.cases.length, 0); assert.equal(issue(pair).quantity, 6);
  assert.equal(canOperateRd(pair.rd, pair.defects, 'issue-process', 'quality-a', 'assign'), true);
  assert.equal(canOperateRd(pair.rd, pair.defects, 'issue-process', 'rd-a', 'assign'), false);
});

test('指定研发保留原异常号/发起人/来源数量，重复指派复用原协同', () => {
  const pair = assigned(), original = issue(fresh());
  assert.equal(issue(pair).code, original.code); assert.equal(issue(pair).sourceKey, original.sourceKey); assert.equal(issue(pair).quantity, original.quantity);
  assert.equal(issue(pair).ownerId, 'rd-a'); assert.equal(issue(pair).direction, 'rd'); assert.equal(pair.defects.collaborations.length, 1);
  assert.equal(pair.defects.collaborations[0].actorId, 'quality-a'); assert.equal(record(pair).collaborationId, pair.defects.collaborations[0].id);
  const again = act(pair, assign({ description: '补充处理期限', dueDate: '2026-09-18' }));
  assert.equal(again.defects.collaborations.length, 1); assert.equal(record(again).events.length, 2); assert.equal(again.defects.issues.length, pair.defects.issues.length);
});

test('P08 已转研发可直接由原协同建立技术记录，保留 P08 的发起人', () => {
  const pair = fresh(); pair.defects = defectsModel.applyDefectAction(pair.defects, pair.defects.version, { ...assign(), kind: 'route', direction: 'rd', causeStatus: 'pending', cause: '' }, now);
  assert.equal(record(pair).status, 'processing'); assert.equal(pair.rd.cases.length, 0);
  const result = act(pair, opinion()); assert.equal(record(result).status, 'opinion-ready'); assert.equal(result.defects, pair.defects); assert.equal(result.defects.collaborations[0].actorId, 'quality-a');
});

test('请求资料只能由当前研发处理人发起，补充回到处理且不改变技术数量', () => {
  const pair = assigned(); for (const actorId of ['quality-a', 'line-b', 'qc-a', 'viewer-a']) assert.ok(err(pair, request({ actorId }))._form);
  const waiting = act(pair, request()); assert.equal(record(waiting).status, 'awaiting-info'); assert.match(record(waiting).infoRequest, /尺寸/);
  assert.ok(err(waiting, opinion())._form); assert.ok(err(waiting, provide({ actorId: 'line-a' }))._form);
  const resumed = act(waiting, provide()); assert.equal(record(resumed).status, 'processing'); assert.equal(record(resumed).infoRequest, undefined); assert.equal(resumed.defects, pair.defects);
});

test('必填资料和证据必须是非空字符串，超长输入阻断', () => {
  assert.ok(err(assigned(), request({ request: ' ' })).request);
  const waiting = act(assigned(), request());
  assert.ok(err(waiting, provide({ response: '' })).response); assert.ok(err(waiting, provide({ evidence: '' })).evidence);
  assert.ok(err(waiting, provide({ response: 'x'.repeat(2001) })).response);
});

test('技术意见要求依据和明确的图纸/SOP判断，需要更新时必须给出引用', () => {
  const pair = assigned();
  for (const [field, patch] of [['text', { text: '' }], ['basis', { basis: '' }], ['drawingChange', { drawingChange: '' }], ['sopChange', { sopChange: 'unknown' }], ['drawingReference', { drawingChange: 'yes' }], ['sopReference', { sopChange: 'yes' }]]) assert.ok(err(pair, opinion(patch))[field]);
  const result = act(pair, opinion({ drawingChange: 'yes', drawingReference: 'ECN-DEMO-1' })); assert.equal(record(result).opinions[0].drawingReference, 'ECN-DEMO-1'); assert.equal(result.defects, pair.defects);
});

test('没有已提交技术意见不能送现场验证或直接关闭', () => {
  const pair = assigned(); assert.ok(err(pair, send())._form); assert.ok(err(pair, close())._form);
  assert.equal(canOperateRd(pair.rd, pair.defects, 'issue-process', 'quality-a', 'close'), false);
});

test('现场验证人只允许本线或质量/QC，计划必须是真实的未来或当日日期', () => {
  const pair = ready(); assert.deepEqual(getRdVerifiers(pair.defects, 'issue-process').map((actor) => actor.id), ['quality-a', 'line-b', 'qc-a']);
  for (const verifierId of ['line-a', 'rd-a', 'viewer-a', 'missing']) assert.ok(err(pair, send({ verifierId })).verifierId);
  for (const plannedDate of ['2026-02-30', '2026-09-13', '', 'invalid']) assert.ok(err(pair, send({ plannedDate })).plannedDate);
});

test('只允许指定验证人记录结果，实际日期不能未来或早于安排日', () => {
  const pair = verifying(); assert.equal(record(pair).verifications[0].opinionId, record(pair).opinions[0].id);
  for (const actorId of ['quality-a', 'rd-a', 'qc-a', 'line-a']) assert.ok(err(pair, verify({ actorId }))._form);
  for (const date of ['2026-09-15', '2026-09-13', '2026-02-30']) assert.ok(err(pair, verify({ date })).date);
  assert.ok(err(pair, verify({ result: 'unknown' })).result); assert.ok(err(pair, verify({ evidence: '' })).evidence); assert.ok(err(pair, verify({ note: '' })).note);
});

test('现场验证未通过返回研发，必须提交新意见再安排下一轮', () => {
  const pair = act(verifying(), verify({ result: 'failed', note: '调整后仍存在配合干涉' }));
  assert.equal(record(pair).status, 'processing'); assert.ok(err(pair, close())._form); assert.ok(err(pair, send())._form);
  const result = act(act(pair, opinion({ text: '补充建议：复核定位销中心距' })), send());
  assert.equal(record(result).opinions.length, 2); assert.equal(record(result).verifications.length, 2);
  assert.notEqual(record(result).verifications[0].opinionId, record(result).verifications[1].opinionId); assert.equal(record(result).verifications[0].result, 'failed');
});

test('现场通过只解锁发起方/质量关闭，不解锁研发或其他岗位', () => {
  const pair = verified(); assert.equal(record(pair).status, 'verified');
  for (const actorId of ['rd-a', 'line-b', 'qc-a', 'viewer-a']) assert.ok(err(pair, close({ actorId }))._form);
  assert.ok(err(pair, close({ summary: '' })).summary); assert.ok(err(pair, close({ reviewed: false })).reviewed);
});

test('技术协同关闭保持 P08 原不良未关闭、数量和 QC 回执完全不变', () => {
  const pair = verified(), before = structuredClone(pair.defects); const result = act(pair, close());
  assert.equal(record(result).status, 'closed'); assert.ok(record(result).closedAt); assert.equal(issue(result).closedAt, undefined);
  assert.deepEqual(result.defects, before); assert.equal(defectsModel.getDefectProgress(result.defects, 'issue-process').remaining, 6);
  for (const kind of Object.keys({ assign: 1, 'request-info': 1, 'provide-info': 1, opinion: 1, 'send-verification': 1, verify: 1, close: 1 })) assert.equal(canOperateRd(result.rd, result.defects, 'issue-process', 'quality-a', kind), false);
});

test('技术关闭必须绑定最新意见、通过结果和证据，旧通过记录不可复用', () => {
  const pair = verified(); record(pair).verifications[0].opinionId = 'old-opinion'; assert.ok(err(pair, close())._form);
  const noEvidence = verified(); record(noEvidence).verifications[0].evidence = ''; assert.ok(err(noEvidence, close())._form);
});

test('保留 P08 方向切换约束，仍有待交接数量不能从 P04 转研发', () => {
  const pair = fresh(); assert.ok(err(pair, assign({ issueId: 'issue-final' })).direction);
  assert.throws(() => act(pair, assign({ issueId: 'issue-final' })), /待交接|更换处理方向/);
});

test('原异常在 P08 改向或关闭后，P04 技术操作不能继续提交', () => {
  const pair = assigned(); issue(pair).direction = 'onsite'; assert.ok(err(pair, opinion())._form);
  issue(pair).direction = 'rd'; issue(pair).closedAt = now; assert.ok(err(pair, opinion())._form);
});

test('模型不可变，技术及原异常的版本冲突都阻断旧回调', () => {
  const pair = freeze(assigned()), before = structuredClone(pair); const result = act(pair, opinion()); assert.deepEqual(pair, before); assert.notEqual(result.rd, pair.rd);
  assert.throws(() => applyRdAction(pair.rd, pair.defects, 999, pair.defects.version, opinion(), now), /已变化/);
  assert.throws(() => applyRdAction(pair.rd, pair.defects, pair.rd.version, 999, opinion(), now), /已变化/);
  assert.throws(() => act(pair, opinion(), 'bad-time'), /操作时间/);
});

test('未知异常、未知操作、无效业务日期不写入', () => {
  const pair = fresh(); assert.ok(err(pair, assign({ issueId: 'missing' }))._form); assert.ok(err(pair, { kind: 'destroy' })._form);
  assert.ok(validateRdAction(pair.rd, pair.defects, assign(), 'bad-day')._form); assert.deepEqual(pair, fresh());
});

test('P08 与 P04 会话共享原异常，重置任一入口同时使技术记录失效且不持久化', () => {
  const session = load('defects/defectPreviewSession.ts', { './defectModel': defectsModel });
  const rdSession = load('rd-collaboration/rdPreviewSession.ts', { '../defects/defectPreviewSession': session, './rdModel': model });
  const initial = { rd: rdSession.getRdPreviewState(), defects: session.getDefectPreviewState() }, result = act(initial, assign());
  session.setDefectPreviewState(result.defects); rdSession.setRdPreviewState(result.rd);
  assert.equal(session.getDefectPreviewState(), result.defects); assert.equal(rdSession.getRdPreviewState(), result.rd);
  session.resetDefectPreviewState(); assert.equal(rdSession.getRdPreviewState().cases.length, 0); assert.equal(session.getDefectPreviewState().collaborations.length, 0);
  assert.equal(session.getDefectPreviewState().issues.find((item) => item.id === 'issue-process').quantity, 6);
});
