import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { ProcurementService } from '../src/modules/procurement/procurement.service';
import { BomRevisionsService } from '../src/modules/procurement/bom-revisions.service';
import { buildBomSnapshot } from '../src/modules/procurement/bom-revisions.model';
test('旧备货确认采用当前版本，保留已有任务；CAS、权限、幂等同时约束', async () => {
  const snapshot = buildBomSnapshot({ deviceId: 'd', productRootId: 'p', structure: [{ id: 'd', parentId: null, name: 'Q7' }, { id: 'l', parentId: 'd', name: '阀' }], leaves: [{ nodeId: 'l', parentId: 'd', deviceId: 'd', materialId: 'm', code: 'V', name: '阀', unit: '件', qtyPer: 1 }] });
  const plan = { id: 's', planType: 'machine', productId: 'product', productLine: 'Q7', bomRevisionId: null, updatedAt: new Date('2026-09-22T00:00:00Z'), tasks: [{ id: 'existing-task' }] };
  const requests = new Map(), audits: any[] = [];
  const db: any = { $queryRaw: async () => [], procStockPlan: { findUnique: async () => plan, update: async ({ data }) => Object.assign(plan, data) },
    procBomNode: { findUnique: async () => ({ id: 'd', parentId: null, productRootId: 'p', productLine: 'Q7' }) },
    procTaskTreeNode: { findUnique: async () => ({ id: 'p', parentId: null, productId: 'product' }) },
    procBomRevision: { findUnique: async () => ({ id: 'r', deviceId: 'd', productRootId: 'p', retiredAt: null, snapshot, fingerprint: snapshot.fingerprint }) },
    runtimeState: { findUnique: async ({ where }) => requests.get(where.key), create: async ({ data }) => requests.set(data.key, data) },
    auditLog: { create: async ({ data }) => audits.push(data) },
  };
  db.$transaction = async work => work(db);
  const service = new ProcurementService(db, null as never, null as never, null as never, undefined, new BomRevisionsService(db));
  const input = { revisionId: 'r', expectedUpdatedAt: plan.updatedAt.toISOString(), requestId: 'stock-basis-request-001', reason: '从本次核对起采用，原任务不变' };
  const actor = { id: 'u', name: '经办', permissions: ['page:proc-cockpit', 'proc-task:create', 'bom:publish'] };
  await assert.rejects(service.confirmStockPlanBomBasis('s', input, { ...actor, permissions: ['proc-task:create', 'bom:publish'] }), /权限/);
  await assert.rejects(service.confirmStockPlanBomBasis('s', { ...input, expectedUpdatedAt: '2020-01-01' }, actor), /更新/);
  await service.confirmStockPlanBomBasis('s', input, actor); await service.confirmStockPlanBomBasis('s', input, actor);
  assert.equal(plan.bomRevisionId, 'r'); assert.equal((plan as any).bomBasis.origin, 'confirmed-current');
  assert.deepEqual(plan.tasks, [{ id: 'existing-task' }]); assert.equal(audits.length, 1);
  await assert.rejects(service.confirmStockPlanBomBasis('s', { ...input, reason: '另一次请求内容' }, actor), /提交标识/);
});
