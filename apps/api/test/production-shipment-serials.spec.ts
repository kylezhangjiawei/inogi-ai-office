import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { ProductionLifecycleService, emptyLifecycle, lifecycleKey } from '../src/modules/procurement/production-lifecycle.service';
import { executionToday } from '../src/modules/procurement/production-execution.model';

const actor = { id: 'shipper', name: '发货员', permissions: ['*'] }, today = executionToday();
function fixture() {
  const state = new Map<string, { key: string; value: string }>(), audits: unknown[] = [];
  const put = (key: string, value: unknown) => state.set(key, { key, value: JSON.stringify(value) });
  function plan(id = 'plan') {
    put(`procurement:execution:v1:plan:${id}`, { id, month: today.slice(0, 7), version: 1, productId: 'product', productName: '产品', targetQty: 100, shipmentTargetQty: 100, bom: [], batches: [{ id: 'batch', quantity: 100, code: 'B1', dueDate: today }], tasks: [{ id: 'whole', batchId: 'batch', output: 'whole', ownerId: 'worker', status: 'dispatched', reports: [{ id: 'r1', quantity: 100 }], inspections: [{ id: 'i1', reportId: 'r1', kind: 'final', quantity: 100, goodQty: 100 }] }] });
  }
  const matches = (key: string, pattern: any) => typeof pattern === 'string' ? key === pattern : key.startsWith(pattern.startsWith);
  const db: any = {
    runtimeState: {
      findUnique: async ({ where }: any) => state.get(where.key) ?? null,
      findMany: async ({ where }: any) => [...state.values()].filter(row => where.OR ? where.OR.some((entry: any) => matches(row.key, entry.key)) : matches(row.key, where.key)),
      create: async ({ data }: any) => { assert.equal(state.has(data.key), false); state.set(data.key, { ...data }); return data; },
      updateMany: async ({ where, data }: any) => { const row = state.get(where.key); if (!row || row.value !== where.value) return { count: 0 }; state.set(where.key, { ...row, ...data }); return { count: 1 }; },
    },
    user: { findMany: async () => [] }, procTask: { findMany: async () => [] }, procQualityRecord: { findMany: async () => [] },
    auditLog: { create: async ({ data }: any) => audits.push(data) },
    $transaction: async (run: any, options: any) => { assert.equal(options.isolationLevel, 'Serializable'); const before = new Map(state), count = audits.length; try { return await run(db); } catch (error) { state.clear(); before.forEach((row, key) => state.set(key, row)); audits.length = count; throw error; } },
  };
  const service = new ProductionLifecycleService(db); plan();
  const current = (id = 'plan') => state.has(lifecycleKey(id)) ? JSON.parse(state.get(lifecycleKey(id))!.value) : emptyLifecycle();
  let sequence = 0;
  const command = (action: string, data: Record<string, unknown>, id = 'plan', user = actor) => service.command(id, { action, version: current(id).version, requestId: `shipment-serial-test-${++sequence}`, data: { reason: '实物与发货凭证核对', ...data } }, user);
  const range = (serialNumbers: string[], id = 'plan', extra: Record<string, unknown> = {}) => command('version-range', { batchId: 'batch', quantity: 100, range: '全批', softwareVersion: 'S1', hardwareVersion: 'H1', serialNumbers, ...extra }, id);
  const ship = (serialNumbers?: string[], id = 'plan', quantity = 20) => command('ship', { batchId: 'batch', quantity, date: today, order: 'SO', voucher: `${id}-voucher-${sequence + 1}`, recipient: '客户', serialNumbers }, id);
  const release = (id = 'plan') => command('release', { batchId: 'batch', quantity: 100, evidenceChecked: true }, id);
  return { db, state, audits, put, plan, current, command, range, ship, release, service };
}

test('单次发货20关联已有12个SN明确待补8；其他批次号码不自动算已关联，旧单全部待补', async () => {
  const f = fixture(), numbers = Array.from({ length: 20 }, (_, i) => `SN-${i + 1}`);
  await f.range(numbers); await f.release(); await f.ship(numbers.slice(0, 12)); await f.ship();
  const view = await f.service.read('plan', actor);
  assert.deepEqual(view.shipments.map(row => [row.quantity, row.linkedSerialQty, row.pendingSerialQty]), [[20, 12, 8], [20, 0, 20]]);
  assert.deepEqual(view.shipments[0].serials?.map(row => row.number), numbers.slice(0, 12));
  const saved = f.current(); delete saved.shipments[1].serials; delete saved.shipments[1].serialHistory; f.put(lifecycleKey('plan'), saved);
  assert.equal((await f.service.read('plan', actor)).shipments[1].pendingSerialQty, 20);
});

test('拒绝不存在/已被更正范围/别的批次SN、重复和超实发数，失败不留下凭证或占用', async () => {
  const f = fixture(); await f.range(['SN-A', 'SN-B']); await f.release();
  const first = f.current().versionRanges[0];
  await f.range(['SN-B', 'SN-C'], 'plan', { supersedesId: first.id });
  const current = f.current(); current.versionRanges.push({ ...first, id: 'other-range', batchId: 'other-batch', serialNumbers: ['OTHER'] }); f.put(lifecycleKey('plan'), current);
  for (const numbers of [['MISSING'], ['SN-A'], ['OTHER'], ['SN-B', 'sn-b']]) {
    const before = new Map(f.state);
    await assert.rejects(f.ship(numbers), /SN|登记/); assert.deepEqual(f.state, before);
  }
  await assert.rejects(f.ship(['SN-B', 'SN-C'], 'plan', 1), /超过/);
  await f.ship(['sn-b']); assert.equal(f.current().shipments[0].serials[0].number, 'SN-B');
  await assert.rejects(f.ship(['SN-B']), /重复/);
});

test('补录只追加已有SN、数量不增加、幂等重复不重复计入，已满/已冲销/无权限不能补录', async () => {
  const f = fixture(); await f.range(['SN-A', 'SN-B']); await f.release(); await f.ship(['SN-A'], 'plan', 2);
  const original = f.current().shipments[0], input = { action: 'bind-shipment-sns', version: f.current().version, requestId: 'shipment-supplement-idempotent', data: { id: original.id, serialNumbers: ['SN-B'], reason: '补核实发清单' } };
  await assert.rejects(f.service.command('plan', input, { id: 'worker', name: '员工', permissions: ['page:production-execution'] }), /权限/);
  await f.service.command('plan', input, actor); await f.service.command('plan', input, actor);
  const saved = f.current().shipments[0]; assert.equal(saved.quantity, 2); assert.equal(saved.serials.length, 2); assert.equal(saved.serialHistory.length, 2); assert.equal(saved.serialHistory[0].serials.length, 1);
  await assert.rejects(f.command('bind-shipment-sns', { id: saved.id, serialNumbers: ['SN-A'] }), /超过|重复/);
  await f.command('reverse-shipment', { id: saved.id, evidenceChecked: true });
  await assert.rejects(f.command('bind-shipment-sns', { id: saved.id, serialNumbers: ['SN-A'] }), /冲销/);
  assert.equal((await f.service.read('plan', actor)).batches[0].shippedQty, 0);
});

test('跨计划也不能重复发相同规范化SN；冲销仅释放本单SN，原快照和冲销依据保留', async () => {
  const f = fixture(); await f.range(['SN-A', 'SN-B']); await f.release(); await f.ship(['SN-A'], 'plan', 1); await f.ship(['SN-B'], 'plan', 1);
  f.plan('other'); await f.range(['ＳＮ-Ａ', 'SN-B'], 'other'); await f.release('other');
  await assert.rejects(f.ship(['ＳＮ-Ａ'], 'other', 1), /其他有效发货/);
  const first = f.current().shipments[0]; await f.command('reverse-shipment', { id: first.id, evidenceChecked: true, reason: '整单取消、实物已退回' });
  await f.ship(['ＳＮ-Ａ'], 'other', 1); await assert.rejects(f.ship(['SN-B'], 'other', 1), /其他有效发货/);
  const reversed = f.current().shipments[0]; assert.deepEqual(reversed.serials, first.serials); assert.equal(reversed.serialHistory.at(-1).action, 'reverse'); assert.equal(reversed.serialHistory.at(-1).reason, '整单取消、实物已退回');
  assert.equal((await f.service.read('plan', actor)).batches[0].shippedQty, 1);
});

test('版本更正不能移走有效已发SN；可更正版本但发货快照保持原值，多次更正仍保护已发SN', async () => {
  const f = fixture(); await f.range(['SN-A', 'SN-B']); await f.release(); await f.ship(['SN-A']);
  const first = f.current().versionRanges[0];
  await assert.rejects(f.range(['SN-B'], 'plan', { supersedesId: first.id }), /已发货 SN/);
  await f.range(['SN-A', 'SN-B'], 'plan', { supersedesId: first.id, softwareVersion: 'S2' });
  const second = f.current().versionRanges.at(-1); await assert.rejects(f.range(['SN-B'], 'plan', { supersedesId: second.id }), /已发货 SN/);
  assert.equal(f.current().shipments[0].serials[0].softwareVersion, 'S1');
  await f.command('bind-shipment-sns', { id: f.current().shipments[0].id, serialNumbers: ['SN-B'] });
  assert.equal(f.current().shipments[0].serials[1].softwareVersion, 'S2');
});

test('补录保持版本并发保护且普通现场只能读取本人批次的发货SN', async () => {
  const f = fixture(); await f.range(['SN-A']); await f.release(); await f.ship();
  await assert.rejects(f.service.command('plan', { action: 'bind-shipment-sns', version: 0, requestId: 'shipment-stale-version-test', data: { id: f.current().shipments[0].id, serialNumbers: ['SN-A'], reason: '补录' } }, actor), /已更新/);
  await assert.rejects(f.command('bind-shipment-sns', { id: f.current().shipments[0].id, serialNumbers: [] }), /请选择/);
  await assert.rejects(f.service.read('plan', { id: 'unrelated', name: '无关人员', permissions: ['page:production-execution'] }), /本人参与/);
  const visible = await f.service.read('plan', { id: 'worker', name: '现场', permissions: ['page:production-execution'] }); assert.equal(visible.shipments.length, 1);
});

test('跨单SN占用并发更改导致整次冲销回滚，不能释放别单关联', async () => {
  const f = fixture(); await f.range(['SN-A']); await f.release(); await f.ship(['SN-A']);
  const shipment = f.current().shipments[0], before = new Map(f.state), update = f.db.runtimeState.updateMany;
  f.db.runtimeState.updateMany = async (args: any) => args.where.key.startsWith('procurement:lifecycle:v1:shipment-sn:') ? { count: 0 } : update(args);
  await assert.rejects(f.command('reverse-shipment', { id: shipment.id, evidenceChecked: true }), /正在更新/);
  assert.deepEqual(f.state, before); assert.equal(f.current().shipments[0].reversed, undefined);
  f.db.runtimeState.updateMany = update;
  const key = [...f.state.keys()].find(key => key.startsWith('procurement:lifecycle:v1:shipment-sn:'))!;
  f.put(key, { planId: 'other', shipmentId: 'another-shipment', active: true });
  await assert.rejects(f.command('reverse-shipment', { id: shipment.id, evidenceChecked: true }), /其他发货单/);
  assert.equal(JSON.parse(f.state.get(key)!.value).shipmentId, 'another-shipment');
});
