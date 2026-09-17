import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { Prisma } from '@prisma/client';
import { KeyMaterialsService } from '../src/modules/procurement/key-materials.service';
const reader = { id: 'reader', name: '查看人', permissions: ['page:proc-key-materials'] };
const reviewer = { id: 'reviewer', name: '核对人', permissions: ['page:proc-key-materials', 'material:review'] };
function fixture() {
  const state = new Map<string, { key: string; value: string; updatedAt: Date }>();
  const audits: unknown[] = [];
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
    auditLog: { create: async ({ data }: any) => { audits.push(data); } },
    $transaction: async (run: (db: unknown) => Promise<unknown>) => run(prisma),
  };
  return { service: new KeyMaterialsService(prisma as never, undefined as never), state, audits, materials };
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
