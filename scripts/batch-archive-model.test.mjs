import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

const source = readFileSync(new URL('../src/app/production/batch-archives/batchArchiveModel.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
const forbidden = () => { throw new Error('档案演示不得调用接口或持久化'); };
const storage = new Proxy({}, { get: forbidden, set: forbidden });
const model = {};
new Function('exports', 'fetch', 'localStorage', 'sessionStorage', 'indexedDB', compiled)(model, forbidden, storage, storage, storage);
const { createBatchArchiveState, getArchiveSummary, getArchiveGaps, validateVersionAmendment, applyVersionAmendment, buildBatchArchiveCsv } = model;
const now = '2026-09-11T04:00:00.000Z';
const batch = (state, id = 'batch-02') => state.batches.find((item) => item.id === id);
const freeze = (value) => { Object.freeze(value); for (const entry of Object.values(value)) if (entry && typeof entry === 'object' && !Object.isFrozen(entry)) freeze(entry); return value; };
const blankVersions = { software: '', hardware: '', bom: '', drawing: '', sop: '', sip: '' };
const input = (patch = {}) => ({ name: '剩余 16 台', quantity: 16, versions: { ...blankVersions, software: 'V1.1.0', hardware: 'HW-C', bom: 'BOM-V3.2' }, serialNumbers: [], evidenceIds: ['b2-technical'], actor: '工程师 C', reason: '按随批记录核对剩余适用范围', ...patch });
const edit = (state, patch = {}) => ({ ...structuredClone(batch(state).versionScopes[1]), scopeId: 'scope-b2-second', actor: '工程师 C', reason: '核对硬件及软件版本', ...patch });
const apply = (state, changes = input(), version = state.version) => applyVersionAmendment(state, 'batch-02', version, changes, now);

// Small RFC 4180 reader used to verify fields rather than searching escaped CSV text.
function parseCsv(csv) {
  const rows = []; let row = []; let field = ''; let quoted = false;
  const text = csv.replace(/^\uFEFF/, '');
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (char === '"') quoted = false;
      else field += char;
    } else if (char === '"') quoted = true;
    else if (char === ',') { row.push(field); field = ''; }
    else if (char === '\r' && text[i + 1] === '\n') { row.push(field); rows.push(row); row = []; field = ''; i++; }
    else field += char;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows;
}

test('默认档案分别统计完工、累计检验合格、授权放行、实际出货和完整度', () => {
  const state = createBatchArchiveState();
  assert.deepEqual(getArchiveSummary(batch(state)), { completed: 116, inspected: 116, released: 100, shipped: 80, versionConfirmed: 60, versionPending: 56, snKnown: 5, snMissing: 111 });
  assert.equal(batch(state).versionScopes.reduce((sum, scope) => sum + scope.quantity, 0), 100);
  assert.equal(batch(state).documents.filter((doc) => doc.kind === 'production').reduce((sum, doc) => sum + doc.quantity, 0), 236);
  assert.equal(batch(state).documents.find((doc) => doc.kind === 'reinspection').quantity, 6);
  assert.equal(batch(state).documents.find((doc) => doc.status === '待确认').quantity, 20);
  assert.equal(batch(state).documents.find((doc) => doc.status === '已冲销').quantity, 10);
});

test('已补齐档案与历史缺失档案均保留真实完整度差异', () => {
  const state = createBatchArchiveState();
  assert.deepEqual(getArchiveSummary(batch(state, 'batch-01')), { completed: 100, inspected: 100, released: 100, shipped: 100, versionConfirmed: 100, versionPending: 0, snKnown: 100, snMissing: 0 });
  assert.deepEqual(getArchiveGaps(batch(state, 'batch-01')), []);
  assert.deepEqual(getArchiveSummary(batch(state, 'batch-03')), { completed: 50, inspected: 50, released: 0, shipped: 0, versionConfirmed: 0, versionPending: 50, snKnown: 0, snMissing: 50 });
  assert.deepEqual(getArchiveGaps(batch(state, 'batch-03')).map((item) => item.id), ['versions', 'sn', 'material-batches', 'sources', 'release']);
});

test('关联 ECN 的发布状态与日期与 P10 来源一致，不替换本批历史实际版本', () => {
  const ecnSource = readFileSync(new URL('../src/app/production/ecn/ecnModel.ts', import.meta.url), 'utf8');
  const ecnCode = ts.transpileModule(ecnSource, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  const ecnModel = {};
  new Function('exports', 'fetch', 'localStorage', 'sessionStorage', 'indexedDB', ecnCode)(ecnModel, forbidden, storage, storage, storage);
  const archive = batch(createBatchArchiveState());
  const reference = archive.documents.find((document) => document.id === 'b2-ecn');
  const published = ecnModel.createEcnState().records.find((record) => record.code === reference.code);
  assert.ok(published); assert.equal(published.status, 'published'); assert.equal(reference.status, '已发布');
  assert.equal(reference.date, published.publishedAt.slice(0, 10)); assert.equal(reference.date, '2026-09-09');
  assert.equal(reference.tone, 'neutral'); assert.equal(reference.facts[0].value, 'V1.2.0');
  assert.match(reference.facts[1].value, /新投产批次/); assert.match(reference.facts[1].value, /B-FG-0902 保留原随批版本/);
  assert.equal(archive.versionScopes[0].versions.software, 'V1.1.0'); assert.equal(archive.completedQty, 116);
});

test('创建状态不共享数组、原始事实或修订快照', () => {
  const first = createBatchArchiveState(); const second = createBatchArchiveState();
  batch(first).versionScopes[0].versions.software = 'MUTATED';
  batch(first).documents[0].facts[0].value = 'MUTATED';
  first.revisions[0].before[0].serialNumbers.push('MUTATED');
  assert.equal(batch(second).versionScopes[0].versions.software, 'V1.1.0');
  assert.equal(batch(second).documents[0].facts[0].value, 'PP-202609-002');
  assert.equal(second.revisions[0].before[0].serialNumbers.includes('MUTATED'), false);
});

test('材料 SN 与整机 SN 相互独立，材料批次及 SN 均由关联领料凭据佐证', () => {
  const state = createBatchArchiveState();
  const finishedSN = new Set(state.batches.flatMap((item) => item.serials.map((serial) => serial.sn)));
  for (const item of state.batches) for (const material of item.materials) {
    const sources = item.documents.filter((doc) => material.sourceDocumentIds.includes(doc.id));
    for (const sn of material.serialNumbers) {
      assert.equal(finishedSN.has(sn), false, `${sn} 不能同时作为材料和整机编号`);
      assert.ok(sources.some((doc) => doc.kind === 'issue' && doc.serialNumbers.includes(sn)), `${sn} 须有领料凭据来源`);
    }
    if (material.materialBatch) assert.ok(sources.some((doc) => doc.facts.some((fact) => fact.label === '物料批次' && fact.value === material.materialBatch)));
    assert.ok(sources.every((doc) => ['issue', 'return'].includes(doc.kind)), '物料来源不能借用只证明整机版本的技术单据');
  }
  const second = batch(state);
  assert.equal(second.materials[0].serialNumbers.length, 3);
  assert.equal(getArchiveSummary(second).snKnown, 5, '材料 SN 不计入整机 SN 完整度');
  assert.throws(() => apply(state, input({ serialNumbers: [second.materials[0].serialNumbers[0]] })), /只能关联本批已有 SN/);
  const exported = parseCsv(buildBatchArchiveCsv(state, 'batch-02'));
  assert.ok(exported.some((row) => row[0] === '物料与领退料' && row[2] === '已有材料 SN' && row[3].includes('PCB-260901-B-001')));
});

test('SN 按忽略大小写的唯一非空编号计数且最多覆盖完工数量', () => {
  const item = batch(createBatchArchiveState());
  item.serials.push({ sn: ' in100-0902-001 ', sourceDocumentId: 'b2-technical' }, { sn: ' ', sourceDocumentId: '' });
  assert.equal(getArchiveSummary(item).snKnown, 5);
  item.completedQty = 2;
  assert.equal(getArchiveSummary(item).snKnown, 2); assert.equal(getArchiveSummary(item).snMissing, 0);
});

test('实际出货只统计明确已出库状态，草稿、冲销及未知状态不计入', () => {
  const item = batch(createBatchArchiveState());
  const actual = item.documents.find((doc) => doc.id === 'b2-shipment');
  for (const status of ['待确认', '已冲销', '已打印', '已放行', '已归档']) {
    actual.status = status; assert.equal(getArchiveSummary(item).shipped, 0);
  }
  actual.status = '已出库'; assert.equal(getArchiveSummary(item).shipped, 80);
});

test('待补齐项由数据生成并区分部分范围缺版本与未分配范围', () => {
  const item = batch(createBatchArchiveState()); const gaps = getArchiveGaps(item);
  assert.deepEqual(gaps.map((entry) => entry.id), ['versions', 'sn', 'material-batches', 'release', 'shipments']);
  assert.match(gaps[0].detail, /56 台/); assert.match(gaps[0].detail, /16 台/);
  item.documents.find((doc) => doc.kind === 'exception').status = '处理中';
  item.inspectionPassedQty = 110;
  item.serials[0].sourceDocumentId = 'missing';
  assert.ok(getArchiveGaps(item).some((gap) => gap.id === 'exceptions'));
  assert.ok(getArchiveGaps(item).some((gap) => gap.id === 'inspection' && gap.detail.includes('6 台')));
  assert.ok(getArchiveGaps(item).some((gap) => gap.id === 'sources'));
});

test('补充剩余 16 台版本只提升版本完整度，不改其他业务事实', () => {
  const original = freeze(createBatchArchiveState()); const changes = freeze(input());
  validateVersionAmendment(original, 'batch-02', changes);
  const next = apply(original, changes);
  assert.equal(next.version, 2); assert.equal(getArchiveSummary(batch(next)).versionConfirmed, 76);
  assert.equal(getArchiveSummary(batch(next)).versionPending, 40);
  assert.deepEqual(batch(next).documents, batch(original).documents);
  assert.deepEqual(batch(next).materials, batch(original).materials);
  assert.deepEqual(batch(next).serials, batch(original).serials);
  const { versionScopes: oldScopes, ...oldFacts } = batch(original);
  const { versionScopes: newScopes, ...newFacts } = batch(next);
  assert.deepEqual(newFacts, oldFacts); assert.equal(oldScopes.length, 2); assert.equal(newScopes.length, 3);
  assert.deepEqual(next.batches.filter((item) => item.id !== 'batch-02'), original.batches.filter((item) => item.id !== 'batch-02'));
  assert.equal(changes.scopeId, undefined);
});

test('部分版本可保存且不会虚增版本已确认数量', () => {
  const next = apply(createBatchArchiveState(), input({ versions: { ...blankVersions, hardware: 'HW-C' } }));
  assert.equal(getArchiveSummary(batch(next)).versionConfirmed, 60);
  assert.equal(getArchiveSummary(batch(next)).versionPending, 56);
  assert.equal(batch(next).versionScopes[2].versions.software, '');
});

test('修订既有范围保留完整修改前后快照及原始 ECN / 检验事实', () => {
  const original = freeze(createBatchArchiveState());
  const next = apply(original, edit(original, { versions: { ...blankVersions, software: 'V1.1.0', hardware: 'HW-C', bom: 'BOM-V3.2' } }));
  const revision = next.revisions.at(-1);
  assert.equal(revision.batchId, 'batch-02'); assert.equal(revision.scopeId, 'scope-b2-second');
  assert.equal(revision.actor, '工程师 C'); assert.equal(revision.at, now);
  assert.equal(revision.before.length, 2); assert.equal(revision.after.length, 2);
  assert.equal(revision.before[1].versions.software, ''); assert.equal(revision.after[1].versions.software, 'V1.1.0');
  assert.equal(getArchiveSummary(batch(next)).versionConfirmed, 100);
  assert.equal(batch(next).documents.find((doc) => doc.id === 'b2-ecn').facts[0].value, 'V1.2.0');
  assert.equal(batch(next).versionScopes[0].versions.software, 'V1.1.0');
  assert.deepEqual(next.revisions[0], original.revisions[0]);
  batch(next).versionScopes[1].versions.software = 'changed later';
  assert.equal(revision.after[1].versions.software, 'V1.1.0');
  revision.before[0].versions.software = 'changed snapshot';
  assert.equal(revision.after[0].versions.software, 'V1.1.0');
});

test('无变化修订即使只换数组顺序、大小写或原因也被拒绝', () => {
  const state = createBatchArchiveState();
  assert.throws(() => apply(state, edit(state)), /没有变化/);
  assert.throws(() => apply(state, edit(state, { serialNumbers: [...batch(state).versionScopes[1].serialNumbers].reverse().map((sn) => sn.toLowerCase()), reason: '仅调整填写顺序' })), /没有变化/);
});

test('清理首尾空白，关联 SN 采用已有来源的规范拼写', () => {
  const state = createBatchArchiveState();
  const changes = edit(state, { name: '  第二段复核  ', actor: '  工程师 C  ', reason: '  核对标签  ', serialNumbers: [' in100-0902-061 ', 'IN100-0902-062'], versions: { ...blankVersions, hardware: ' HW-C ', bom: ' BOM-V3.2 ' } });
  const next = apply(state, changes); const scope = batch(next).versionScopes[1];
  assert.equal(scope.name, '第二段复核'); assert.equal(scope.versions.hardware, 'HW-C');
  assert.equal(scope.serialNumbers[0], 'IN100-0902-061'); assert.equal(next.revisions.at(-1).actor, '工程师 C');
  assert.equal(changes.name, '  第二段复核  ');
});

test('陈旧版本、重复提交、无效时间与不存在的批次不会修改状态', () => {
  const state = freeze(createBatchArchiveState());
  for (const expected of [0, 2, 1.2, NaN, '1']) assert.throws(() => apply(state, input(), expected), /档案已变化/);
  const next = apply(state);
  assert.throws(() => apply(next, input(), 1), /档案已变化/);
  assert.throws(() => applyVersionAmendment(state, 'missing', 1, input(), now), /档案已不存在/);
  assert.throws(() => applyVersionAmendment(state, 'batch-02', 1, input(), 'invalid'), /时间无效/);
  assert.equal(state.version, 1); assert.equal(batch(state).versionScopes.length, 2);
});

for (const quantity of [0, -1, 1.5, Infinity, NaN, '16', Number.MAX_SAFE_INTEGER + 1]) {
  test(`拒绝非正安全整数适用数量 ${String(quantity)}`, () => {
    assert.throws(() => apply(createBatchArchiveState(), input({ quantity })), /须为大于 0 的整数/);
  });
}

test('新增与编辑均校验范围数量总和；缩减后才能重分配剩余数量', () => {
  const state = createBatchArchiveState();
  assert.throws(() => apply(state, input({ quantity: 17 })), /不能超过本批完工数量/);
  assert.throws(() => apply(state, edit(state, { quantity: 57 })), /不能超过本批完工数量/);
  const reduced = apply(state, edit(state, { quantity: 30 }));
  const added = apply(reduced, input({ quantity: 26 }));
  assert.equal(batch(added).versionScopes.reduce((sum, scope) => sum + scope.quantity, 0), 116);
});

test('重复范围名、无效范围及完全空版本均拒绝', () => {
  const state = createBatchArchiveState();
  assert.throws(() => apply(state, input({ name: ' 首段 60 台 ' })), /名称已存在/);
  assert.throws(() => apply(state, input({ scopeId: 'missing' })), /范围已不存在/);
  assert.throws(() => apply(state, input({ scopeId: '' })), /请填写版本范围/);
  assert.throws(() => apply(state, input({ versions: { ...blankVersions } })), /至少填写一项/);
  assert.throws(() => apply(state, input({ versions: null })), /版本格式无效/);
});

test('必填修订人、原因、范围及来源凭据均拒绝缺失和超长文本', () => {
  const state = createBatchArchiveState();
  for (const [field, max] of [['name', 120], ['actor', 80], ['reason', 1000]]) {
    assert.throws(() => apply(state, input({ [field]: '  ' })), /请填写/);
    assert.throws(() => apply(state, input({ [field]: '字'.repeat(max + 1) })), /不能超过/);
    assert.throws(() => apply(state, input({ [field]: 123 })), /格式无效/);
  }
  assert.throws(() => apply(state, input({ versions: { ...blankVersions, hardware: 'x'.repeat(81) } })), /不能超过 80 字/);
  for (const evidenceIds of [[], ['missing'], ['b1-technical'], ['b2-technical', 'b2-technical']]) assert.throws(() => apply(state, input({ evidenceIds })), /凭据/);
  assert.throws(() => apply(state, input({ evidenceIds: 'b2-technical' })), /格式无效/);
});

test('关联 SN 必须来自本批且不能重复、跨范围复用或超过范围数量', () => {
  const state = createBatchArchiveState();
  for (const serialNumbers of [['NEW-SN'], ['IN100-0901-001']]) assert.throws(() => apply(state, input({ serialNumbers })), /只能关联本批已有 SN/);
  assert.throws(() => apply(state, edit(state, { serialNumbers: ['IN100-0902-061', 'in100-0902-061'] })), /重复项/);
  assert.throws(() => apply(state, input({ serialNumbers: ['IN100-0902-001'] })), /已关联其他版本范围/);
  assert.throws(() => apply(state, edit(state, { quantity: 1 })), /SN 数量不能超过/);
  assert.throws(() => apply(state, input({ serialNumbers: 'IN100-0902-061' })), /格式无效/);
  assert.throws(() => apply(state, input({ serialNumbers: [' '] })), /请填写 SN/);
});

test('解除旧范围 SN 关联后可重新分配，同时保留原修订快照', () => {
  const state = createBatchArchiveState();
  const released = apply(state, edit(state, { serialNumbers: ['IN100-0902-062'] }));
  const reassigned = apply(released, input({ serialNumbers: ['in100-0902-061'] }));
  assert.deepEqual(batch(reassigned).versionScopes[2].serialNumbers, ['IN100-0902-061']);
  assert.deepEqual(reassigned.revisions.at(-2).before[1].serialNumbers, ['IN100-0902-061', 'IN100-0902-062']);
  assert.equal(getArchiveSummary(batch(reassigned)).snKnown, 5);
});

test('重复可能的范围和修订编号时生成新的唯一编号', () => {
  const state = createBatchArchiveState();
  batch(state).versionScopes[0].id = 'version-batch-02-2';
  state.revisions[0].id = 'archive-revision-2';
  const next = apply(state);
  assert.equal(batch(next).versionScopes.at(-1).id, 'version-batch-02-2-1');
  assert.equal(next.revisions.at(-1).id, 'archive-revision-2-1');
});

test('CSV 包含全档案章节、所有来源单据、物料、SN 与完整修订前后值', () => {
  const state = apply(createBatchArchiveState());
  const csv = buildBatchArchiveCsv(freeze(state), 'batch-02');
  assert.equal(csv.charCodeAt(0), 0xFEFF);
  const rows = parseCsv(csv);
  assert.ok(rows.every((row) => row.length === 4));
  const fields = rows.map((row) => row[3]);
  for (const value of ['PP-202609-002', 'PCB-260901-B', 'RPT-0904-02', 'RPT-0907-02', 'FQC-0907-02', 'RETEST-0907-02', 'QA-REL-0907-02', 'NCR-0907-02', 'ISS-0902-02', 'RET-0907-02', 'SHIP-0908-01', 'SHIP-0909-01', 'SHIP-0908-ERR', 'ECN-202609-003']) assert.ok(fields.includes(value), value);
  for (const scope of batch(state).versionScopes) assert.ok(rows.some((row) => row[0] === '实际版本' && row[1] === scope.id));
  for (const revision of state.revisions) {
    assert.ok(rows.some((row) => row[0] === '版本修订' && row[1] === revision.id && row[3] === revision.reason));
    assert.ok(rows.some((row) => row[0] === `修订前 / ${revision.id}`));
    assert.ok(rows.some((row) => row[0] === `修订后 / ${revision.id}`));
  }
  assert.ok(rows.some((row) => row[0] === '修订前 / archive-revision-seed' && row[3] === 'V1.0.9'));
  assert.ok(rows.some((row) => row[0] === '修订后 / archive-revision-seed' && row[3] === 'V1.1.0'));
  assert.ok(rows.some((row) => row[0] === '已有 SN' && row[3] === 'IN100-0902-061'));
});

test('CSV 正确保留逗号、引号、换行、中文和零值，缺失值明确待补齐', () => {
  const state = createBatchArchiveState();
  batch(state).documents[0].summary = '第一行,"原始摘要"\n第二行，保留中文';
  const rows = parseCsv(buildBatchArchiveCsv(state, 'batch-02'));
  assert.ok(rows.some((row) => row[3] === '第一行,"原始摘要"\n第二行，保留中文'));
  assert.ok(rows.some((row) => row[1] === 'b2-shell' && row[2] === '关联退料数量' && row[3] === '0'));
  assert.ok(rows.some((row) => row[1] === 'b2-shell' && row[2] === '供应批次' && row[3] === '待补齐'));
});

test('CSV 所有单元格阻止公式及前导空白 / 控制字符绕过', () => {
  const payloads = ['=1+1', '+SUM(A1)', '-1+1', '@SUM(A1)', '  =HYPERLINK("evil")', '\t=1+1', '\r\n+1', '\u0000@SUM(A1)', '\uFEFF=1+1', '\ttext'];
  for (const payload of payloads) {
    const state = createBatchArchiveState(); batch(state).documents[0].facts = [{ label: payload, value: payload }];
    const row = parseCsv(buildBatchArchiveCsv(state, 'batch-02')).find((item) => item[0] === '来源凭据明细' && item[1] === 'WO-0902-01');
    assert.equal(row[2], `'${payload}`); assert.equal(row[3], `'${payload}`);
  }
});

test('导出不泄露其他批次修订，纯读取不会更改现有状态', () => {
  const state = freeze(createBatchArchiveState()); const before = JSON.stringify(state);
  const first = parseCsv(buildBatchArchiveCsv(state, 'batch-01'));
  assert.equal(first.some((row) => row.includes('archive-revision-seed')), false);
  assert.equal(first.some((row) => row.includes('IN100-0902-001')), false);
  assert.throws(() => buildBatchArchiveCsv(state, 'missing'), /档案已不存在/);
  assert.equal(JSON.stringify(state), before);
});

test('历史档案第一次补充版本的修订导出明确保留空的修改前范围', () => {
  const state = createBatchArchiveState();
  const next = applyVersionAmendment(state, 'batch-03', 1, input({ name: '历史批次硬件确认', quantity: 50, versions: { ...blankVersions, hardware: 'HW-B' }, evidenceIds: ['b3-technical'] }), now);
  const rows = parseCsv(buildBatchArchiveCsv(next, 'batch-03'));
  assert.ok(rows.some((row) => row[0] === '修订前 / archive-revision-2' && row[3] === '无已记录范围'));
  assert.equal(getArchiveSummary(batch(next, 'batch-03')).versionConfirmed, 0);
});
