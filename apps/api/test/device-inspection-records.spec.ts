import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { canonicalJson, parseQuery, uploadHash, validateUpload, verifiedUid, type UploadEnvelope } from '../src/modules/device-inspection-records/device-inspection-records.contract';
import { createFixtureServer, memoryPrisma } from './device-inspection-records.fixture';

const envelope = (id = 'QC-TEST-001'): UploadEnvelope => ({ contractVersion: 1, source: { clientId: 'fixture-client', uploaderAppVersion: '0.5.13', recordAppVersion: null }, snapshotSchema: 'factoryqc.workstation.v1',
  snapshot: { testId: id, mode: 'Workstation', saveStatus: 'Saved', status: 'Ng', productionPass: false, startedAt: '2026-09-10T08:00:00+08:00', protocolReadAt: '2026-09-10T08:00:01+08:00', endedAt: '2026-09-10T08:00:02+08:00',
    identity: { uid: '6D004E003451333034363036', serialNumber: '', model: 'Q7', market: '美国', station: 'A-02', operator: '测试员' },
    uidEvidence: { status: 'verified', uid: '6D004E003451333034363036', responseHex: 'F5 14 EB 87 6D 00 4E 00 34 51 33 30 34 36 30 36 A5 E2 BB 25' },
    protocolReadings: [{ id: 'uid', status: 'received', responseHex: 'F5 14 EB 87 6D 00 4E 00 34 51 33 30 34 36 30 36 A5 E2 BB 25' }],
    items: [{ id: 'QC-001', name: '机器型号', measuredValue: 'Q7', unit: '', status: 'ReadComplete', qcConditionResult: 'display-only' }, { id: 'QC-009', name: '压力', measuredValue: '—', unit: '', status: 'WaitingMeasurement', readEvidence: { responseHex: 'F5 07 F8 78 01 00 00' } }, { id: 'QC-006', name: 'Debug', measuredValue: '1', unit: '', status: 'ReadComplete' }],
    ruleVersion: 'frozen-v1', protocolVersion: 'wire-v3' },
  resultProjection: { mapperVersion: 'qc-result-v1', inspectionResult: 'NG', items: [{ id: 'QC-001', result: null }, { id: 'QC-009', result: null }, { id: 'QC-006', result: 'NG' }] } });
const status = (code: number) => (error: any) => error.getStatus?.() === code;

test('immutable record, exact frozen projection, idempotent retry and transport-only version changes', async () => {
  const f = memoryPrisma(), input = envelope();
  const first = await f.service.upload(input);
  assert.equal(first.duplicate, false); assert.equal(f.rows.size, 1);
  const retry = structuredClone(input); retry.source.uploaderAppVersion = '0.5.14';
  assert.equal(uploadHash(input), uploadHash(retry));
  const repeated = await f.service.upload(retry); assert.equal(repeated.recordId, first.recordId); assert.equal(repeated.duplicate, true);
  input.snapshot.items[1].readEvidence.responseHex = 'changed';
  await assert.rejects(f.service.upload(input), status(409));
  const detail = await f.service.detail(first.recordId);
  assert.equal(detail.uploaderAppVersion, '0.5.13'); assert.equal(detail.productionPass, false); assert.equal(detail.inspectionResult, 'NG');
  assert.equal((detail.snapshot as any).items[1].readEvidence.responseHex, 'F5 07 F8 78 01 00 00');
  assert.equal('itemStatusKeys' in detail, false);
  assert.deepEqual(detail.resultProjection, envelope().resultProjection);
  assert.equal(detail.abnormalCount, 2); assert.equal(detail.pendingCount, 1); assert.equal(detail.saveAt, null);
});
test('concurrent duplicate uploads create one row; differing projection conflicts', async () => {
  const f = memoryPrisma(); const receipts = await Promise.all([f.service.upload(envelope()), f.service.upload(envelope())]);
  assert.equal(f.rows.size, 1); assert.equal(receipts.filter(r => r.duplicate).length, 1);
  const changed = envelope(); changed.resultProjection.inspectionResult = 'PASS';
  await assert.rejects(f.service.upload(changed), status(409));
});
test('same-device history needs verified full UID, never a shared short suffix or claimed verified flag', async () => {
  const f = memoryPrisma(), first = await f.service.upload(envelope());
  const later = envelope('QC-TEST-002'); later.snapshot.protocolReadAt = '2026-09-10T09:00:01+08:00';
  const second = await f.service.upload(later);
  const invalid = envelope('QC-TEST-003'); invalid.snapshot.identity.uid = 'FFFFFFFF3451333034363036';
  const third = await f.service.upload(invalid);
  const history = await f.service.history(first.recordId, { page: 1, pageSize: 25 });
  assert.equal(history.available, true); assert.deepEqual(history.items.map(i => i.id), [second.recordId, first.recordId]);
  const unavailable = await f.service.history(third.recordId, { page: 1, pageSize: 25 }); assert.equal(unavailable.available, false); assert.equal(unavailable.total, 0);
  const crc = envelope().snapshot; crc.protocolReadings[0].responseHex = crc.uidEvidence.responseHex = crc.uidEvidence.responseHex.replace('BB 25', 'BB 24');
  assert.equal(verifiedUid(crc).uidVerified, false);
  const duplicate = envelope().snapshot; duplicate.protocolReadings.push(duplicate.protocolReadings[0]); assert.equal(verifiedUid(duplicate).uidVerified, false);
});
test('list combines collection time, text, result, abnormal and same-item read-status filters', async () => {
  const f = memoryPrisma(); await f.service.upload(envelope());
  const good = envelope('QC-OK'); good.snapshot.protocolReadAt = '2026-09-11T08:00:00+08:00'; good.resultProjection.inspectionResult = 'PASS';
  good.snapshot.items = [{ id: 'QC-009', name: '压力', measuredValue: '192', unit: 'kPa', status: 'ReadComplete' }]; good.resultProjection.items = [{ id: 'QC-009', result: 'PASS' }];
  await f.service.upload(good);
  const page = await f.service.list(parseQuery({ search: '测试员', from: '2026-09-09T16:00:00Z', to: '2026-09-10T15:59:59Z', result: 'NG', abnormalOnly: 'true', itemId: 'QC-009', readStatus: 'WaitingMeasurement' }));
  assert.equal(page.total, 1); assert.equal(page.items[0].testId, 'QC-TEST-001'); assert.equal('snapshot' in page.items[0], false);
  const wrongPair = await f.service.list(parseQuery({ itemId: 'QC-006', readStatus: 'WaitingMeasurement' })); assert.equal(wrongPair.total, 0);
  const pairedButNotAbnormal = await f.service.list(parseQuery({ itemId: 'QC-001', abnormalOnly: 'true' })); assert.equal(pairedButNotAbnormal.total, 0);
  const paged = await f.service.list(parseQuery({ page: '2', pageSize: '1' })); assert.equal(paged.total, 2); assert.equal(paged.items[0].testId, 'QC-TEST-001');
});
test('contract rejects malformed dates, projections, ambiguous IDs and oversized structures', () => {
  for (const mutate of [
    (x: any) => { x.snapshot.startedAt = '2026-02-30T00:00:00Z'; },
    (x: any) => { x.snapshot.startedAt = '2026-09-10'; },
    (x: any) => { x.resultProjection.items.pop(); },
    (x: any) => { x.resultProjection.items[1].id = 'QC-001'; },
    (x: any) => { x.snapshot.items[1].id = 'QC-001'; },
    (x: any) => { x.source.clientId = '../other'; },
    (x: any) => { x.source.extra = 'unknown'; },
    (x: any) => { x.snapshot.startedAt = '2026-09-10T00:00:00+14:30'; },
    (x: any) => { x.snapshot.mode = 'Demo'; },
    (x: any) => { x.snapshot.saveStatus = 'Pending'; },
    (x: any) => { x.snapshot.items = []; x.resultProjection.items = []; },
  ]) { const x = envelope(); mutate(x); assert.throws(() => validateUpload(x), status(400)); }
  const huge = envelope(); huge.snapshot.large = Array(24).fill('a'.repeat(100000)); assert.throws(() => validateUpload(huge), status(413));
  for (const q of [{ page: '0' }, { pageSize: '101' }, { abnormalOnly: '1' }, { result: 'pass' }, { from: '2026-09-10T00:00:00Z', to: '2026-09-09T00:00:00Z' }, { search: ['a', 'b'] }]) assert.throws(() => parseQuery(q), status(400));
});
test('waiting sensor evidence indexes the same status as the UI; informational and power-pending rows stay distinct', async () => {
  const f = memoryPrisma(), input = envelope();
  input.snapshot.items[1].status = 'ReadError';
  input.snapshot.items[1].readEvidence.fields = [{ id: 'status', numericValue: 1 }];
  input.snapshot.items.push({ id: 'QC-018', name: '档位', status: 'AwaitingPowerCheck', measuredValue: '3', unit: '档' });
  input.resultProjection.items.push({ id: 'QC-018', result: null });
  await f.service.upload(input);
  const waiting = await f.service.list(parseQuery({ itemId: 'QC-009', readStatus: 'WaitingMeasurement', abnormalOnly: 'true' }));
  assert.equal(waiting.total, 1); assert.equal(waiting.items[0].pendingCount, 2);
  assert.equal(waiting.items[0].abnormalCount, 2);
  const power = await f.service.list(parseQuery({ itemId: 'QC-018', abnormalOnly: 'true' })); assert.equal(power.total, 0);
});
test('canonical hash sorts UTF16 keys, preserves arrays and excludes uploader version only', () => {
  assert.equal(canonicalJson({ z: '中文🔎', a: [-0, 1e-7, 1e21] }), '{"a":[0,1e-7,1e+21],"z":"中文🔎"}');
  const a = envelope(), b = envelope(); b.source.recordAppVersion = '0.5.12'; assert.notEqual(uploadHash(a), uploadHash(b));
});
test('actual Nest HTTP: dedicated upload token, JWT read permission, duplicate receipt, filters and UID history', async () => {
  const server = await createFixtureServer();
  const send = (pathname: string, init: RequestInit = {}) => fetch(server.url + pathname, init);
  const post = (body: any, token?: string) => send('/api/factory-qc/records', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) });
  try {
    assert.equal((await post(envelope())).status, 401);
    assert.equal((await post(envelope(), server.adminToken)).status, 401);
    const response = await post(envelope(), server.uploadToken); assert.equal(response.status, 201); const saved = await response.json() as any;
    assert.equal((await post(envelope(), server.uploadToken)).status, 200);
    assert.equal((await send('/api/device-inspection-records')).status, 401);
    assert.equal((await send('/api/device-inspection-records', { headers: { Authorization: `Bearer ${server.uploadToken}` } })).status, 401);
    assert.equal((await send('/api/device-inspection-records', { headers: { Authorization: `Bearer ${server.noPermissionToken}` } })).status, 403);
    const headers = { Authorization: `Bearer ${server.adminToken}` };
    const page = await (await send('/api/device-inspection-records?itemId=QC-009&readStatus=WaitingMeasurement', { headers })).json() as any; assert.equal(page.total, 1);
    const detail = await (await send(`/api/device-inspection-records/${saved.recordId}`, { headers })).json() as any; assert.equal(detail.payloadHash, saved.payloadHash);
    const history = await (await send(`/api/device-inspection-records/${saved.recordId}/history`, { headers })).json() as any; assert.equal(history.available, true); assert.equal(history.total, 1);
    assert.equal((await send('/api/device-inspection-records?page=0', { headers })).status, 400);
    const oversized = await send('/api/factory-qc/records', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${server.uploadToken}` }, body: JSON.stringify(envelope()) + ' '.repeat(2 * 1024 * 1024) }); assert.equal(oversized.status, 413);
    const malformed = await send('/api/factory-qc/records', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${server.uploadToken}` }, body: '{bad' }); assert.equal(malformed.status, 400);
  } finally { await server.app.close(); }
});
test('HTTP upload remains disabled with 503 when the configured token is absent', async () => {
  const server = await createFixtureServer({ uploadToken: '' });
  try { const response = await fetch(server.url + '/api/factory-qc/records', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(envelope()) }); assert.equal(response.status, 503); assert.equal(server.store.rows.size, 0); }
  finally { await server.app.close(); }
});
test('additive migration declares database idempotency and immutable evidence columns', () => {
  const sql = readFileSync(join(__dirname, '../prisma/migrations/20260910183000_device_inspection_records/migration.sql'), 'utf8');
  assert.match(sql, /CREATE UNIQUE INDEX "DeviceInspectionRecord_clientId_testId_key"/);
  assert.match(sql, /"snapshot" JSONB NOT NULL/); assert.match(sql, /"resultProjection" JSONB NOT NULL/);
  assert.doesNotMatch(sql, /\b(DROP|DELETE|UPDATE|TRUNCATE)\b/i);
});
