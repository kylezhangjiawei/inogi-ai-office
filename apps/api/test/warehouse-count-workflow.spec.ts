import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { Prisma } from '@prisma/client';
import { WarehouseRecordsService, warehouseRecordKey, pendingCountReduction } from '../src/modules/procurement/warehouse-records.service';

const initiator = { id: 'finance', name: '发起人', permissions: ['page:warehouse-count', 'warehouse:count-initiate'] };
const counter = { id: 'store', name: '仓管', permissions: ['page:warehouse-flow', 'warehouse:count'] };
const approver = { id: 'reviewer', name: '复核人', permissions: ['page:warehouse-count', 'warehouse:adjust'] };
function fixture() {
  const state = new Map<string, { key: string; value: string }>();
  const balance = { id: 'balance-1', tpInventoryCode: 'M1', warehouse: '原料仓', unit: '件', stockQty: new Prisma.Decimal(200), availableQty: new Prisma.Decimal(180), syncedAt: new Date('2026-09-01T00:00:00Z'), material: { name: '阀体' } };
  const db: any = { runtimeState: {
    findUnique: async ({ where }: any) => state.get(where.key),
    findMany: async ({ where }: any) => [...state.values()].filter(row => row.key.startsWith(where.key.startsWith)),
    create: async ({ data }: any) => { assert.ok(!state.has(data.key)); state.set(data.key, data); },
    updateMany: async ({ where, data }: any) => { if (state.get(where.key)?.value !== where.value) return { count: 0 }; state.set(where.key, { key: where.key, ...data }); return { count: 1 }; },
  }, procInventoryBalance: { findUnique: async ({ where }: any) => where.tpInventoryCode_warehouse.tpInventoryCode === 'M1' ? balance : null, findMany: async () => [balance] }, procPurchaseReceipt: { findMany: async () => { throw new Error('盘点权限不能读取收货'); } }, auditLog: { create: async () => {} } };
  db.$transaction = async (run: any) => { const before = new Map(state); try { return await run(db); } catch (error) { state.clear(); before.forEach((v, k) => state.set(k, v)); throw error; } };
  const service = new WarehouseRecordsService(db);
  let n = 0;
  const read = (id: string) => JSON.parse(state.get(warehouseRecordKey(id))!.value);
  const command = (action: string, actor = initiator, data = {}, id?: string, version = id ? read(id).version : undefined) => service.command({ action, requestId: `count-workflow-test-${++n}`, id, version, data: { reason: '月末盘点', ...data } }, actor);
  const start = () => command('start-count', initiator, { code: 'M1', warehouse: '原料仓', batch: '九月盘点' });
  return { service, command, start, read, balance, state };
}

test('盘点由发起权限建立账面快照，实盘与复核分开，未复核不影响库存', async () => {
  const f = fixture(), { id } = await f.start();
  assert.equal(f.read(id).countStage, 'counting'); assert.equal(f.read(id).bookQty, 200); assert.equal(f.read(id).countedQty, undefined);
  await assert.rejects(f.command('approve-count', approver, {}, id), /实盘/);
  await assert.rejects(f.command('submit-count', initiator, { countedQty: 198 }, id), /权限/);
  await f.command('submit-count', counter, { countedQty: 198 }, id);
  assert.equal(f.read(id).countStage, 'review'); assert.equal(f.read(id).quantity, -2); assert.equal(f.read(id).countedBy, 'store');
  assert.equal(pendingCountReduction([f.read(id)], 'M1', '原料仓', f.balance.syncedAt).toNumber(), 0);
  await assert.rejects(f.command('approve-count', { ...counter, permissions: [...counter.permissions, 'warehouse:adjust'] }, {}, id), /不同人员/);
  await f.command('approve-count', approver, {}, id);
  assert.equal(f.read(id).status, 'confirmed'); assert.equal(f.read(id).actorId, 'finance'); assert.equal(f.read(id).confirmedBy, 'reviewer');
  assert.deepEqual(f.read(id).events.map((e: any) => e.action), ['start-count', 'submit-count', 'approve-count']);
  assert.equal(pendingCountReduction([f.read(id)], 'M1', '原料仓', f.balance.syncedAt).toNumber(), 2);
  assert.equal(f.balance.stockQty.toNumber(), 200);
});

test('隐藏按钮之外，服务端拒绝无发起权限、旧接口绕过和跨业务越权', async () => {
  const f = fixture();
  await assert.rejects(f.command('start-count', counter, { code: 'M1', warehouse: '原料仓', batch: '范围' }), /权限/);
  await assert.rejects(f.command('count', counter, { code: 'M1', warehouse: '原料仓', batch: '范围', countedQty: 198 }), /权限|发起/);
  await assert.rejects(f.command('freeze', { ...initiator, permissions: [...initiator.permissions, 'warehouse:adjust'] }, { code: 'M1', warehouse: '原料仓', quantity: 1 }), /权限/);
  const { id } = await f.start();
  const foreign = { ...f.read(id), id: 'return-1', kind: 'return' };
  f.state.set(warehouseRecordKey('return-1'), { key: warehouseRecordKey('return-1'), value: JSON.stringify(foreign) });
  const listed = await f.service.list(initiator);
  assert.deepEqual(listed.records.map(row => row.id), [id]); assert.deepEqual(listed.receipts, []);
  await assert.rejects(f.command('cancel', initiator, {}, 'return-1'), /权限/);
});

test('盘点阻止重复范围、负实盘、过期版本；库存快照变更后必须重新盘核', async () => {
  const f = fixture(), { id } = await f.start();
  await assert.rejects(f.start(), /已有/);
  await assert.rejects(f.command('submit-count', counter, { countedQty: -1 }, id), /数量/);
  await assert.rejects(f.command('submit-count', counter, { countedQty: 198 }, id, 99), /更新/);
  f.balance.syncedAt = new Date('2026-09-02T00:00:00Z');
  await assert.rejects(f.command('submit-count', counter, { countedQty: 198 }, id), /库存来源/);
  await f.command('cancel', initiator, {}, id);
  const fresh = await f.start(); assert.notEqual(fresh.id, id);
});

test('盘点发起重试幂等，实盘提交后不能覆盖或提前增加可用库存', async () => {
  const f = fixture();
  const input = { action: 'start-count', requestId: 'count-workflow-idempotent', data: { code: 'M1', warehouse: '原料仓', batch: '月末', reason: '核对' } };
  const { id } = await f.service.command(input, initiator);
  assert.deepEqual(await f.service.command(input, initiator), { id });
  await f.command('submit-count', counter, { countedQty: 0 }, id);
  await assert.rejects(f.command('submit-count', counter, { countedQty: 201 }, id), /状态|提交/);
  await assert.rejects(f.command('approve-count', approver, {}, id), /占用/);
  assert.equal(f.read(id).status, 'pending'); assert.equal(f.read(id).countedQty, 0);
});
