import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { WarehouseRecordsService, warehouseRecordKey, warehouseReturns } from '../src/modules/procurement/warehouse-records.service';

function fixture() {
  const record = { id: 'R1', version: 1, kind: 'return', status: 'pending', quantity: 6, qualifiedQty: 0, defectiveQty: 6, pendingQty: 0, code: 'M1', unit: '件', name: '阀体', warehouse: '量产仓', actorId: 'producer', actorName: '生产', origin: 'unused', sourceId: 'I1', taskId: 'T1', planId: 'P1', events: [] };
  const state = new Map<string, { key: string; value: string }>();
  const put = (key: string, value: unknown) => state.set(key, { key, value: JSON.stringify(value) });
  put(warehouseRecordKey('R1'), record);
  put('procurement:warehouse-flow:v1:issue:T1', { lines: [{ code: 'M1', signedQty: 10 }], history: [] });
  put('procurement:execution:v1:plan:P1', { tasks: [{ id: 'T1', materials: [{ code: 'M1', qtyPer: 1 }], reports: [] }] });
  const db: any = { runtimeState: {
    findUnique: async ({ where }: any) => state.get(where.key),
    findMany: async ({ where }: any) => [...state.values()].filter(row => row.key.startsWith(where.key.startsWith)),
    create: async ({ data }: any) => { assert.ok(!state.has(data.key)); state.set(data.key, data); },
    updateMany: async ({ where, data }: any) => { if (state.get(where.key)?.value !== where.value) return { count: 0 }; state.set(where.key, { key: where.key, ...data }); return { count: 1 }; },
  }, auditLog: { create: async () => {} } };
  db.$transaction = async (run: any) => run(db);
  let n = 0;
  const service = new WarehouseRecordsService(db);
  const warehouse = { id: 'warehouse', name: '仓管', permissions: ['page:warehouse-flow', 'warehouse:receive'] };
  const producer = { id: 'producer', name: '生产', permissions: ['page:production-execution'] };
  const read = () => JSON.parse(state.get(warehouseRecordKey('R1'))!.value);
  const command = (action: string, data: Record<string, unknown>, actor = warehouse, version = read().version) => service.command({ action, data: { reason: '实物核对', ...data }, id: 'R1', version, requestId: `return-review-test-${++n}` }, actor);
  return { db, read, command, warehouse, producer, service };
}

test('退回核对不入账，只允许原填报人更正后重新提交，接收保留质量状态和库位', async () => {
  const f = fixture();
  await f.command('review-return', { receivedQty: 4 });
  assert.equal(f.read().review.open, true); assert.equal(f.read().status, 'pending');
  assert.equal((await warehouseReturns(f.db, 'T1')).length, 0);
  await assert.rejects(f.command('receive-return', { receivedQty: 6 }), /核对/);
  await assert.rejects(f.command('resubmit-return', { quantity: 4 }), /原填报人/);
  await assert.rejects(f.command('resubmit-return', { quantity: 11 }, f.producer), /超过原实收/);
  await f.command('resubmit-return', { quantity: 4 }, f.producer);
  assert.equal(f.read().quantity, 4); assert.equal(f.read().defectiveQty, 4); assert.equal(f.read().review.open, false);
  await assert.rejects(f.command('receive-return', { receivedQty: 3 }), /不一致/);
  await f.command('receive-return', { receivedQty: 4, warehouse: '隔离仓', receivingLocation: 'A-01', qualifiedQty: 4 });
  assert.equal(f.read().status, 'confirmed'); assert.equal(f.read().warehouse, '隔离仓'); assert.equal(f.read().receivingLocation, 'A-01');
  assert.equal(f.read().qualifiedQty, 0); assert.equal(f.read().defectiveQty, 4);
  assert.equal((await warehouseReturns(f.db, 'T1')).length, 1);
  await assert.rejects(f.command('review-return', { receivedQty: 4 }), /待接收/);
});

test('退料核对校验权限、数量、版本；不确定响应重试只登记一次', async () => {
  const f = fixture();
  await assert.rejects(f.command('review-return', { receivedQty: 0 }, f.producer), /权限/);
  await assert.rejects(f.command('review-return', { receivedQty: -1 }), /数量/);
  await assert.rejects(f.command('review-return', { receivedQty: 0 }, f.warehouse, 99), /更新/);
  const input = { action: 'review-return', id: 'R1', version: 1, requestId: 'return-review-replay-1', data: { reason: '未收到实物', receivedQty: 0 } };
  await f.service.command(input, f.warehouse); await f.service.command(input, f.warehouse);
  assert.equal(f.read().events.length, 1); assert.equal(f.read().review.actualQty, 0);
  await assert.rejects(f.service.command({ ...input, data: { ...input.data, receivedQty: 2 } }, f.warehouse), /提交编号/);
});
