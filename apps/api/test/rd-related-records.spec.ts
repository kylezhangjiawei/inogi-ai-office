import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { ForbiddenException } from '@nestjs/common';
import { RDRelatedRecordsService } from '../src/modules/procurement/rd-related-records.service';
const actor = { id: 'me', name: '本人', permissions: ['page:rd-my-workspace'] };
function fixture() {
  const calls: string[] = [], tasks: any[] = [], states: any[] = [], plans: any[] = [];
  const prisma: any = { procTask: { findMany: async (query: any) => { calls.push('procTask'); return query.where.rdTaskId ? tasks.filter(row => row.rdTaskId === query.where.rdTaskId) : tasks; } }, runtimeState: { findMany: async () => { calls.push('runtime'); return states; }, findUnique: async ({ where }: any) => states.find(row => row.key === where.key) ?? null } };
  const rd = { requireTaskReadAccess: async () => { calls.push('rd-access'); } }, execution = { list: async () => { calls.push('execution'); return plans; } }, lifecycle = { read: async (): Promise<any> => { throw new ForbiddenException(); } }, operations = { list: async (query: any) => { calls.push(`operations:${query.owner}:${query.kind}`); return { items: [], nextCursor: null }; } };
  return { calls, tasks, states, plans, rd, execution, lifecycle, operations, service: new RDRelatedRecordsService(prisma, rd as never, execution as never, lifecycle as never, operations as never) };
}
test('R&D association is authorized before any lookup and does not broaden production or commercial rights', async () => {
  const f = fixture(); f.tasks.push({ id: 'P1', rdTaskId: 'RD1', code: 'P-1', materialName: '阀', buyerUserId: 'other', buyer: '其他人' });
  assert.deepEqual(await f.service.related('RD1', actor), { items: [] }); assert.deepEqual(f.calls, ['rd-access', 'procTask']);
  f.rd.requireTaskReadAccess = async () => { throw new ForbiddenException(); }; const count = f.calls.length;
  await assert.rejects(f.service.related('OTHER-RD', actor), ForbiddenException); assert.equal(f.calls.length, count);
});
test('procurement original link requires real ownership and carries real task ID', async () => {
  const f = fixture(); f.tasks.push({ id: 'P/1', rdTaskId: 'RD1', code: 'P-1', materialName: '阀', buyerUserId: 'me', buyer: '本人' });
  const result = await f.service.related('RD1', { ...actor, permissions: [...actor.permissions, 'page:proc-my-workspace'] });
  assert.equal(result.items.length, 1); assert.equal(new URL(result.items[0].href, 'http://local').searchParams.get('task'), 'P/1'); assert.match(result.items[0].href, /^\/proc-my-workspace/);
});
test('ordinary R&D reads only own pending samples; cannot query production or purchase operations', async () => {
  const f = fixture(); const sampleTest = { roundId: 'r1', testerUserId: 'me', testerName: '本人', assignedAt: '2026-09-20', assignedByName: '采购', result: null };
  f.tasks.push({ id: 'sample', code: 'S1', materialName: '本人的样品', metadata: { sampleTest } }, { id: 'other', metadata: { sampleTest: { ...sampleTest, testerUserId: 'other' } } });
  const result = await f.service.mine(actor); assert.equal(result.items.length, 1); assert.equal(result.items[0].id, 'sample'); assert.equal(result.items[0].dueDate, null); assert.equal(result.items[0].detail, '当前样品测试轮次'); assert.deepEqual(f.calls, ['procTask']);
});
test('same-person queue merges original field quality without duplicate and retains due/verification data', async () => {
  const f = fixture(), quality = { id: 'Q1', status: 'processing', issue: '尺寸超差', batchNo: 'REAL-1', collaboration: { ownerId: 'me', ownerName: '本人', phase: 'returned', dueDate: '2026-09-25', requiredInfo: '补图纸', verificationPlan: '复测尺寸' } };
  f.plans.push({ id: 'plan', month: '2026-08', productName: 'Q7', batches: [{ id: 'B1', code: '生产批次-01' }], tasks: [{ id: 'T1', batchId: 'B1', name: '装配', line: 'L1', ownerId: 'other', quantity: 10, status: 'dispatched', date: '2026-08-20', inspections: [{ quality, quantity: 10, goodQty: 0 }], fieldIssues: [{ quality }] }] });
  const result = await f.service.mine({ ...actor, permissions: ['page:production-execution'] });
  assert.equal(result.items.length, 1); assert.equal(result.items[0].kind, 'quality'); assert.equal(result.items[0].code, '生产批次-01'); assert.equal(result.items[0].dueDate, '2026-09-25'); assert.match(result.items[0].detail, /补图纸.*复测尺寸/);
  const link = new URL(result.items[0].href, 'http://local'); assert.equal(link.searchParams.get('month'), '2026-08'); assert.equal(link.searchParams.get('quality'), 'Q1');
});
test('ECN queue includes only own applicable unread changes and assigned unresolved feedback', async () => {
  const f = fixture(); f.states.push({ key: 'procurement:execution:v1:plan:plan', value: JSON.stringify({ id: 'plan', month: '2026-08', productName: 'Q7', tasks: [{ ownerId: 'me', batchId: 'B1', status: 'dispatched' }] }) }, { key: 'procurement:lifecycle:v1:plan:plan', value: JSON.stringify({ changes: [{ id: 'own', code: 'ECN-1', status: 'published', batchIds: ['B1'], acknowledgments: [], effectiveDate: '2026-09-19', feedback: [] }, { id: 'other', code: 'ECN-2', status: 'published', batchIds: ['B2'], acknowledgments: [], feedback: [{ id: 'feedback', ownerId: 'me', ownerName: '本人', status: 'open', dueDate: '2026-09-21', problem: '无法执行' }] }, { id: 'hidden', code: 'ECN-3', status: 'published', batchIds: ['B3'], acknowledgments: [], feedback: [] }] }) });
  const result = await f.service.mine({ ...actor, permissions: ['page:production-execution'] }); assert.deepEqual(result.items.map(row => row.id), ['own', 'feedback']); assert.equal(result.items[1].detail, '无法执行');
});
test('source failures remain explicit and purchase operations are forcibly scoped to the current person', async () => {
  const f = fixture(); f.execution.list = async () => { throw new Error('down'); };
  const result = await f.service.mine({ ...actor, permissions: ['*'] });
  assert.match(result.errors.join(), /现场与质量协同/); assert.ok(f.calls.includes('operations:me:warehouse')); assert.ok(f.calls.includes('operations:me:quality'));
});
