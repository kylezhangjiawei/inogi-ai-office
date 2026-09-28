import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { Prisma } from '@prisma/client';
import { KeyMaterialsService } from '../src/modules/procurement/key-materials.service';
const reader = { id: 'reader', name: '查看人', permissions: ['page:proc-key-materials'] };
const reviewer = { id: 'reviewer', name: '核对人', permissions: ['page:proc-key-materials', 'material:review'] };
function fixture(readiness?: { calculate: (...args: any[]) => Promise<unknown> }) {
  const state = new Map<string, { key: string; value: string; updatedAt: Date }>();
  const audits: unknown[] = [];
  const quality: { id: string; materialId: string; issue: string; status: string }[] = [];
  const materials = [{ id: 'material-1', name: '正式阀体', spec: 'A', unit: '件', category: '阀件', productLine: 'Q7', tpInventoryCode: 'VALVE-1', erpCode: '', balances: [{ warehouse: '量产仓', availableQty: new Prisma.Decimal(0), inTransitQty: new Prisma.Decimal(0), syncedAt: new Date('2026-09-15') }] },
    { id: 'material-2', name: '正式塑料件', spec: 'B', unit: '件', category: '塑料', productLine: 'Q5', tpInventoryCode: 'PLASTIC-1', erpCode: '', balances: [] }];
  const prisma = {
    runtimeState: {
      findUnique: async ({ where }: any) => state.get(where.key) ?? null,
      findMany: async ({ where }: any) => [...state.values()].filter((row) => where.key.in ? where.key.in.includes(row.key) : row.key.startsWith(where.key.startsWith)),
      create: async ({ data }: any) => { if (state.has(data.key)) throw new Error('duplicate'); const row = { ...data, updatedAt: new Date() }; state.set(row.key, row); return row; },
      upsert: async ({ where, create, update }: any) => { const row = { ...(state.get(where.key) ?? create), ...update, updatedAt: new Date() }; state.set(where.key, row); return row; },
    },
    procMaterial: { findMany: async ({ where }: any) => materials.filter((row) => !where.id || where.id.in.includes(row.id)), count: async () => materials.length },
    procQualityRecord: { findMany: async () => quality.filter(row => row.status !== 'closed') },
    procTask: { findMany: async () => [] },
    auditLog: { create: async ({ data }: any) => { audits.push(data); } },
    $transaction: async (run: (db: unknown) => Promise<unknown>) => run(prisma),
  };
  return { service: new KeyMaterialsService(prisma as never, readiness as never), state, audits, materials, quality };
}
const input = { requestId: 'key-material-request-01', version: 0, materialIds: ['material-1'], inclusion: 'included' as const, note: '与受控 BOM 和 ERP 逐项核对' };
test('正式入口保留全部31条会议线索，不注入任何演示库存或默认映射', async () => {
  const f = fixture(), result = await f.service.list(reader);
  assert.equal(result.clues.length, 31); assert.deepEqual(result.clues.map((row) => row.id), Array.from({ length: 31 }, (_, i) => `K${String(i + 1).padStart(2, '0')}`));
  assert.equal(result.materials.length, 0); assert.equal(result.clues[28].mapping.inclusion, 'pending');
  assert.equal(result.clues[29].kind, 'range'); assert.equal(result.canReview, false); assert.equal(f.state.size, 0);
});
test('映射持久化后重新读取有效，零库存条目仍保留，未知库存不伪装为零', async () => {
  const f = fixture(); await f.service.save('K01', input, reviewer);
  await f.service.save('K30', { ...input, requestId: 'key-material-request-02', materialIds: ['material-2'] }, reviewer);
  const result = await f.service.list(reader);
  assert.equal(result.clues[0].mapping.actorId, 'reviewer'); assert.equal(result.clues[0].mapping.version, 1);
  assert.equal(result.materials.find((row) => row.id === 'material-1')?.available, 0);
  assert.equal(result.materials.find((row) => row.id === 'material-2')?.available, null);
  assert.equal(result.clues.length, 31); assert.equal(f.materials[0].balances[0].availableQty.toNumber(), 0);
});
test('重复线索可指向同一物料，物料资产只返回一次，重复提交只保存一次', async () => {
  const f = fixture(); await f.service.save('K01', input, reviewer); await f.service.save('K01', input, reviewer);
  assert.equal(f.audits.length, 1); assert.equal((await f.service.history('K01', reader)).length, 1);
  await f.service.save('K02', input, reviewer);
  assert.equal((await f.service.list(reader)).materials.length, 1);
  await assert.rejects(f.service.save('K01', { ...input, note: '用相同编号覆盖' }, reviewer), /提交编号/);
  await assert.rejects(f.service.save('K01', { ...input, requestId: 'key-material-conflict' }, reviewer), /已被其他人更新/);
});
test('物料审核权限与目录权限同时要求，未知编码及非法范围均拒绝', async () => {
  const f = fixture();
  await assert.rejects(f.service.save('K01', input, reader), /权限/);
  await assert.rejects(f.service.save('K01', input, { ...reviewer, permissions: ['material:review'] }), /权限/);
  await assert.rejects(f.service.list({ ...reader, permissions: [] }), /权限/);
  await assert.rejects(f.service.save('K01', { ...input, materialIds: ['missing'] }, reviewer), /未匹配/);
  await assert.rejects(f.service.save('K01', { ...input, inclusion: 'excluded', materialIds: [] }, reviewer), /固定会议/);
  await assert.rejects(f.service.save('K01', { ...input, materialIds: [] }, reviewer), /至少选择/);
  f.materials[0].tpInventoryCode = '';
  await assert.rejects(f.service.save('K01', input, reviewer), /正式编码/);
  assert.equal(f.state.size, 0);
});
test('网格包纳入待定可核对为排除，保留原因及旧版本历史', async () => {
  const f = fixture(); await f.service.save('K29', { ...input, inclusion: 'excluded', materialIds: [] }, reviewer);
  await f.service.save('K29', { ...input, version: 1, requestId: 'key-material-reinclude' }, reviewer);
  const history = await f.service.history('K29', reader);
  assert.equal(history.length, 2); assert.equal(history[0]?.inclusion, 'excluded'); assert.equal(history[1]?.inclusion, 'included');
});

test('月度计划透传真实产品ID与名称，不从型号猜测产品关联', async () => {
  const f = fixture({ calculate: async (_db, planId, date) => ({ planId, lines: [{ code: 'VALVE-1', unit: '件', demand: 20, remainingDemand: 12, gap: 3, problems: [], incoming: 9, purchase: [] }], date }) });
  await f.service.save('K01', input, reviewer);
  for (const [id, productId, productName] of [['plan-a', 'product-real-a', '便携式制氧机'], ['plan-b', 'product-real-b', '直流式制氧机']]) {
    const key = `procurement:execution:v1:plan:2026-08:${id}`;
    f.state.set(key, { key, value: JSON.stringify({ id, month: '2026-08', productId, productName, productLine: 'Q5' }), updatedAt: new Date() });
  }
  const result = await f.service.monthly('2026-08', '2026-08-31', reader);
  assert.deepEqual(result.materials[0].plans.map(row => [row.planId, row.productId, row.productName, row.productLine]), [
    ['plan-a', 'product-real-a', '便携式制氧机', 'Q5'], ['plan-b', 'product-real-b', '直流式制氧机', 'Q5'],
  ]);
  assert.equal(result.materials[0].plans[0].gap, 3);
  assert.equal(result.materials[0].plans[0].remainingDemand, 12);
  await assert.rejects(f.service.monthly('2026-08', '2026-08-31', { ...reader, permissions: [] }), /权限/);
});

test('正式目录不依赖会议线索，退出覆盖旧映射，恢复、审计、幂等及版本冲突闭环', async () => {
  const f = fixture({ calculate: async () => { throw new Error('没有计划不应计算'); } });
  await f.service.save('material:material-1', input, reviewer);
  await f.service.save('material:material-1', input, reviewer);
  assert.equal(f.audits.length, 1);
  assert.equal((await f.service.list(reader)).materials[0].scope.inclusion, 'included');
  await f.service.save('K01', input, reviewer);
  await f.service.save('material:material-1', { ...input, requestId: 'scope-exclude-request', version: 1, inclusion: 'excluded', materialIds: [], note: '停用设备，不再重点跟踪' }, reviewer);
  const excluded = await f.service.list(reader);
  assert.equal(excluded.materials.length, 1, '保留退出条目以便恢复及追溯');
  assert.equal(excluded.materials[0].scope.inclusion, 'excluded');
  assert.deepEqual(excluded.clues[0].mapping.materialIds, ['material-1'], '会议映射原样保留');
  assert.equal((await f.service.monthly('2026-09', '2026-09-30', reader)).materials.length, 0);
  await assert.rejects(f.service.save('material:material-1', { ...input, requestId: 'scope-stale-request' }, reviewer), /已被其他人更新/);
  await f.service.save('material:material-1', { ...input, version: 2, requestId: 'scope-restore-request', note: '重新纳入' }, reviewer);
  assert.equal((await f.service.history('material:material-1', reader)).length, 3);
  assert.equal((await f.service.monthly('2026-09', '2026-09-30', reader)).materials.length, 1, '本月无需求仍在目录');
  assert.equal(f.materials.length, 2, '不创建或删除物料主档');
});

test('正式范围校验：不能绑其他物料、待定、无依据、越权或虚构物料', async () => {
  const f = fixture();
  await assert.rejects(f.service.save('material:material-1', input, reader), /权限/);
  await assert.rejects(f.service.save('material:material-1', { ...input, materialIds: ['material-2'] }, reviewer), /当前正式物料/);
  await assert.rejects(f.service.save('material:material-1', { ...input, inclusion: 'pending', materialIds: [] }, reviewer), /纳入或退出/);
  await assert.rejects(f.service.save('material:material-1', { ...input, note: ' ' }, reviewer), /依据/);
  await assert.rejects(f.service.save('material:missing', { ...input, inclusion: 'excluded', materialIds: [] }, reviewer), /未匹配/);
  assert.equal(f.state.size, 0);
});

test('原单变化刷新后重算，未分配共享库存不伪装已覆盖，质量关闭不改变缺口', async () => {
  let remainingDemand = 12, ownReserved = 0, warehouse = 20;
  const f = fixture({ calculate: async (_db, planId) => ({ planId, lines: [{ code: 'VALVE-1', unit: '件', demand: 20, remainingDemand, warehouse, ownReserved, lineQty: 0, incoming: 0, gap: Math.max(0, remainingDemand - warehouse), problems: [], purchase: [] }] }) });
  await f.service.save('material:material-1', input, reviewer);
  for (const month of ['2026-09', '2026-10']) {
    const key = `procurement:execution:v1:plan:${month}:p`;
    f.state.set(key, { key, value: JSON.stringify({ id: `${month}:p`, month, targetQty: 20, bom: [{ code: 'VALVE-1' }] }), updatedAt: new Date() });
  }
  let result = await f.service.monthly('2026-09', '2026-09-30', reader);
  assert.equal(result.materials[0].plans[0].gap, null);
  assert.match(result.materials[0].plans[0].problems.join('；'), /共享库存/);
  ownReserved = 12;
  result = await f.service.monthly('2026-09', '2026-09-30', reader);
  assert.equal(result.materials[0].plans[0].gap, 0);
  ownReserved = 8; warehouse = 8;
  assert.equal((await f.service.monthly('2026-09', '2026-09-30', reader)).materials[0].plans[0].gap, 4, '净可用库存已全部分配但仍不足时，保留真实缺口而非永久待核对');
  ownReserved = 0; warehouse = 0;
  result = await f.service.monthly('2026-09', '2026-09-30', reader);
  assert.equal(result.materials[0].plans[0].gap, 12, '释放占用且无库存时风险重新出现');
  f.quality.push({ id: 'quality-1', materialId: 'material-1', issue: '来料异常', status: 'open' });
  assert.equal((await f.service.monthly('2026-09', '2026-09-30', reader)).materials[0].quality.length, 1);
  f.quality[0].status = 'closed';
  result = await f.service.monthly('2026-09', '2026-09-30', reader);
  assert.equal(result.materials[0].quality.length, 0);
  assert.equal(result.materials[0].plans[0].gap, 12, '质量关闭不改变库存及缺口');
  f.quality[0].status = 'open';
  assert.equal((await f.service.monthly('2026-09', '2026-09-30', reader)).materials[0].quality.length, 1, '重开后异常重新出现');
  remainingDemand = 0;
  assert.equal((await f.service.monthly('2026-09', '2026-09-30', reader)).materials[0].plans[0].gap, 0, '完工后按剩余需求计算');
});
