import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { BomRevisionsService } from '../src/modules/procurement/bom-revisions.service';

const actor = { id: 'u', name: '核对人', permissions: ['page:proc-materials', 'bom:publish'] };
function fixture() {
  const rows: any[] = [{ id: 'device', parentId: null, name: 'Q7', productLine: 'Q7', productRootId: null, materialId: null, qtyPer: null, code: null, material: null },
    { id: 'leaf', parentId: 'device', productLine: 'Q7', name: '阀', materialId: 'm', code: 'V1', qtyPer: 2, material: { id: 'm', tpInventoryCode: 'V1', name: '阀', unit: '件' } }];
  const revisions: any[] = [], requests = new Map<string, string>(), audits: any[] = [];
  const db: any = {
    $queryRaw: async () => [],
    procBomNode: { findUnique: async ({ where }) => rows.find(r => r.id === where.id), findMany: async () => structuredClone(rows), update: async ({ where, data }) => Object.assign(rows.find(r => r.id === where.id), data) },
    procTaskTreeNode: { findUnique: async ({ where }) => ({ id: where.id, parentId: where.id === 'child' ? 'root' : null, name: '产品' }), findMany: async () => [{ id: 'root', name: '产品', productId: 'product' }] },
    procBomRevision: {
      findMany: async ({ where }) => revisions.filter(r => r.deviceId === where.deviceId).map(r => structuredClone(r)),
      findFirst: async ({ where }) => revisions.filter(r => r.deviceId === where.deviceId).at(-1) ?? null,
      findUnique: async ({ where }) => revisions.find(r => r.id === where.id) ?? null,
      create: async ({ data }) => { const row = { id: `rev-${revisions.length + 1}`, retiredAt: null, publishedAt: new Date(), ...data }; revisions.push(row); return structuredClone(row); },
      update: async ({ where, data }) => Object.assign(revisions.find(r => r.id === where.id), data),
    },
    runtimeState: { findUnique: async ({ where }) => requests.has(where.key) ? { value: requests.get(where.key) } : null, create: async ({ data }) => { requests.set(data.key, data.value); } },
    auditLog: { create: async ({ data }) => { audits.push(data); } },
  };
  db.$transaction = async (work) => {
    const saved = structuredClone({ rows, revisions, requests, audits });
    try { return await work(db); } catch (e) { rows.splice(0, rows.length, ...saved.rows); revisions.splice(0, revisions.length, ...saved.revisions); requests.clear(); saved.requests.forEach((v,k) => requests.set(k,v)); audits.splice(0,audits.length,...saved.audits); throw e; }
  };
  const service = new BomRevisionsService(db);
  let sequence = 0;
  const input = async () => ({ expectedFingerprint: (await service.read('device', actor)).draftFingerprint, requestId: `bom-request-${String(++sequence).padStart(8,'0')}`, reason: '人工核对' });
  return { service, rows, revisions, requests, audits, input, db };
}
test('动作权限与页面权限必须同时具备，拒绝发生在数据库访问前', async () => {
  const db = new Proxy({}, { get() { throw Error('unexpected database access'); } });
  const service = new BomRevisionsService(db as never);
  await assert.rejects(service.publish('device', { expectedFingerprint: 'x', requestId: 'bom-request-000001', reason: '确认' }, { ...actor, permissions: ['bom:publish'] }), /权限/);
});
test('未绑定不能发布，非根产品不能绑定，发布后不可重新归属', async () => {
  const f = fixture();
  await assert.rejects(f.service.publish('device', await f.input(), actor), /归属/);
  await assert.rejects(f.service.bind('device', { ...await f.input(), productRootId: 'child' }, actor), /根/);
  await f.service.bind('device', { ...await f.input(), productRootId: 'root' }, actor);
  await f.service.publish('device', await f.input(), actor);
  await assert.rejects(f.service.bind('device', { ...await f.input(), productRootId: 'other' }, actor), /发布/);
});
test('发布冻结快照，重复请求不增加版本，草稿改变使旧指纹失效', async () => {
  const f = fixture(); await f.service.bind('device', { ...await f.input(), productRootId: 'root' }, actor);
  const input = await f.input(); const first = await f.service.publish('device', input, actor);
  assert.deepEqual(await f.service.publish('device', input, actor), first); assert.equal(f.revisions.length, 1);
  await assert.rejects(f.service.publish('device', { ...input, reason: '其他内容' }, actor), /提交标识/);
  const stale = await f.input(); f.rows[1].qtyPer = 3;
  await assert.rejects(f.service.publish('device', stale, actor), /更新/);
  assert.equal(f.revisions[0].snapshot.items[0].qtyPer, 2);
  const second = await f.service.publish('device', await f.input(), actor);
  assert.equal(second.version, 2); assert.equal(second.snapshot.items[0].qtyPer, 3);
});
test('停用保留快照与审计，重复停用幂等，不能再被新业务引用', async () => {
  const f = fixture(); await f.service.bind('device', { ...await f.input(), productRootId: 'root' }, actor);
  const published = await f.service.publish('device', await f.input(), actor);
  await f.service.requireRevision(f.db, { productRootId: 'root', deviceId: 'device', revisionId: published.id });
  const input = { requestId: 'retire-request-00001', reason: '版本废止' };
  await f.service.retire(published.id, input, actor); await f.service.retire(published.id, input, actor);
  assert.equal(f.audits.length, 3); assert.deepEqual(f.revisions[0].snapshot, published.snapshot);
  await assert.rejects(f.service.requireRevision(f.db, { productRootId: 'root', deviceId: 'device', revisionId: published.id }), /停用/);
});
test('发布审计失败时快照和幂等记录一起回滚', async () => {
  const f = fixture(); await f.service.bind('device', { ...await f.input(), productRootId: 'root' }, actor);
  f.db.auditLog.create = async () => { throw new Error('audit unavailable'); };
  await assert.rejects(f.service.publish('device', await f.input(), actor), /audit unavailable/);
  assert.equal(f.revisions.length, 0); assert.equal(f.requests.size, 1);
});
