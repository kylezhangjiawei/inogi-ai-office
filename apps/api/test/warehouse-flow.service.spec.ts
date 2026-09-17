import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { Prisma } from '@prisma/client';
import { WarehouseFlowService, type WarehouseIssue, type WarehouseReconcileInput } from '../src/modules/procurement/warehouse-flow.service';
import { TplusSyncService } from '../src/modules/procurement/tplus-sync.service';
import { WAREHOUSE_PREFIX } from '../src/modules/procurement/production-execution.service';
const warehouse = { id: 'warehouse', name: '仓管', permissions: ['page:warehouse-flow', 'warehouse:issue'] };
const worker = { id: 'worker', name: '领料人', permissions: ['page:production-execution'] };
const checker = { id: 'checker', name: '核对人', permissions: ['page:warehouse-flow', 'warehouse:reconcile'] };
function fixture() {
  const issue: WarehouseIssue = { id: 'task-1', kind: 'issue', version: 1, status: 'requested', planId: '2026-09:plan', taskId: 'task-1', batchId: 'b1', productLine: 'Q7', title: '阀装配', neededDate: '2026-09-16', recipientId: 'worker', recipientName: '领料人', lines: [{ code: 'V01', name: '阀体', unit: '件', quantity: 100 }], createdAt: '2026-09-16T00:00:00.000Z', createdBy: 'planner', createdByName: '计划员', history: [] };
  const key = `${WAREHOUSE_PREFIX}issue:${issue.id}`, state = new Map([[key, { key, value: JSON.stringify(issue) }]]), audits: unknown[] = [];
  const balance = { tpInventoryCode: 'V01', warehouse: '量产仓', unit: '件', availableQty: new Prisma.Decimal(100), syncedAt: new Date('2026-09-16') };
  const db = {
    runtimeState: {
      findUnique: async ({ where }: any) => state.get(where.key) ?? null,
      findMany: async ({ where }: any) => [...state.values()].filter((row) => typeof where.key === 'string' ? row.key === where.key : row.key.startsWith(where.key.startsWith)),
      create: async ({ data }: any) => { assert.equal(state.has(data.key), false); state.set(data.key, { ...data }); return data; },
      updateMany: async ({ where, data }: any) => { const current = state.get(where.key); if (!current || current.value !== where.value) return { count: 0 }; state.set(where.key, { ...current, ...data }); return { count: 1 }; },
    },
    procInventoryBalance: { findMany: async () => [balance], findUnique: async ({ where }: any) => where.tpInventoryCode_warehouse.tpInventoryCode === balance.tpInventoryCode && where.tpInventoryCode_warehouse.warehouse === balance.warehouse ? balance : null },
    auditLog: { create: async ({ data }: any) => { audits.push(data); } },
    $transaction: async (run: (db: any) => Promise<unknown>, options: any) => { assert.equal(options.isolationLevel, 'Serializable'); const saved = new Map(state), count = audits.length; try { return await run(db); } catch (error) { state.clear(); saved.forEach((row, key) => state.set(key, row)); audits.length = count; throw error; } },
  };
  return { db, service: new WarehouseFlowService(db as never), state, balance, key, audits, current: () => JSON.parse(state.get(key)!.value) as WarehouseIssue };
}
const issueInput = { action: 'issue', requestId: 'issue-event-request01', version: 1, reason: '现场交接单核对', lines: [{ code: 'V01', quantity: 40, warehouse: '量产仓' }] };
test('其他计划占用只从量产库存总池扣一次，不重复扣在每个仓；发料不能侵占其他计划', async () => {
  const f = fixture(); f.balance.availableQty = new Prisma.Decimal(40);
  const otherBalance = { ...f.balance, warehouse: '量产仓库', availableQty: new Prisma.Decimal(60) };
  f.db.procInventoryBalance.findMany = async () => [f.balance, otherBalance];
  const allocationKey = 'procurement:readiness:v1:allocation:another:V01';
  f.state.set(allocationKey, { key: allocationKey, value: JSON.stringify({ planId: 'another', code: 'V01', quantity: 50 }) });
  await f.service.command('task-1', issueInput, warehouse);
  assert.equal(f.current().lines[0].issuedQty, 40);
  f.balance.availableQty = new Prisma.Decimal(60);
  f.state.set(allocationKey, { key: allocationKey, value: JSON.stringify({ planId: 'another', code: 'V01', quantity: 70 }) });
  await assert.rejects(f.service.command('task-1', { ...issueInput, requestId: 'pool-protected-request1', version: 2, lines: [{ code: 'V01', quantity: 11, warehouse: '量产仓' }] }, warehouse), /其他计划/);
});
test('40件发料连续提交两次只生效一次，保留待T+核对且不写ERP库存', async () => {
  const f = fixture(); await f.service.command('task-1', issueInput, warehouse); await f.service.command('task-1', issueInput, warehouse);
  assert.equal(f.current().lines[0].issuedQty, 40); assert.equal(f.current().history.length, 1); assert.equal(f.current().history[0].erpPosting, 'pending');
  assert.equal(f.balance.availableQty.toNumber(), 100); assert.equal(f.audits.length, 1);
  await assert.rejects(f.service.command('task-1', { ...issueInput, lines: [{ ...issueInput.lines[0], quantity: 41 }] }, warehouse), /提交标识/);
});
test('分批发料、部分签收再发齐签齐，来源和各次记录完整保留', async () => {
  const f = fixture(); await f.service.command('task-1', issueInput, warehouse);
  await f.service.command('task-1', { action: 'sign', version: 2, requestId: 'sign-event-request01', reason: '已清点20件', lines: [{ code: 'V01', quantity: 20 }] }, worker);
  assert.equal(f.current().lines[0].signedQty, 20);
  await f.service.command('task-1', { ...issueInput, version: 3, requestId: 'issue-event-request02', lines: [{ ...issueInput.lines[0], quantity: 60 }] }, warehouse);
  assert.equal(f.current().status, 'issued');
  await f.service.command('task-1', { action: 'sign', version: 4, requestId: 'sign-event-request02', reason: '已清点余下80件', lines: [{ code: 'V01', quantity: 80 }] }, worker);
  assert.equal(f.current().status, 'signed'); assert.equal(f.current().history.length, 4); assert.equal(f.current().planId, '2026-09:plan');
  assert.equal((await f.service.list({}, worker)).items.length, 1, '签收后仍保留待ERP核对记录');
});
test('未授权人员不能发料或代签；现场只能读取本人领料', async () => {
  const f = fixture();
  await assert.rejects(f.service.command('task-1', issueInput, worker), /仓库发料权限/);
  await f.service.command('task-1', issueInput, warehouse);
  await assert.rejects(f.service.command('task-1', { action: 'sign', version: 2, requestId: 'sign-event-request01', reason: '代签', lines: [{ code: 'V01', quantity: 40 }] }, warehouse), /不能代替/);
  assert.equal((await f.service.list({}, { ...worker, id: 'other' })).items.length, 0);
  await assert.rejects(f.service.list({}, { ...worker, permissions: [] }), /权限/);
});
test('超发、超签、单位不一致、旧版本和库存不足均拒绝', async () => {
  const f = fixture();
  await assert.rejects(f.service.command('task-1', { ...issueInput, lines: [{ ...issueInput.lines[0], quantity: 101 }] }, warehouse), /不能超过需求/);
  f.balance.unit = '箱'; await assert.rejects(f.service.command('task-1', issueInput, warehouse), /单位/); f.balance.unit = '件';
  f.balance.availableQty = new Prisma.Decimal(30); await assert.rejects(f.service.command('task-1', issueInput, warehouse), /库存不足/); f.balance.availableQty = new Prisma.Decimal(100);
  await f.service.command('task-1', issueInput, warehouse);
  await assert.rejects(f.service.command('task-1', { action: 'sign', version: 2, requestId: 'sign-over-quantity001', reason: '清点', lines: [{ code: 'V01', quantity: 41 }] }, worker), /超过已发未签/);
  await assert.rejects(f.service.command('task-1', { ...issueInput, requestId: 'issue-stale-request01' }, warehouse), /已更新/);
  assert.equal(f.current().lines[0].issuedQty, 40); assert.equal(f.current().lines[0].signedQty, undefined);
});
test('不同作业共享库存时扣除待核对发料，不能反复使用同一份ERP余额', async () => {
  const f = fixture(); await f.service.command('task-1', issueInput, warehouse);
  const other = { ...f.current(), id: 'task-2', taskId: 'task-2', version: 1, status: 'requested', history: [], lines: [{ code: 'V01', name: '阀体', unit: '件', quantity: 100 }] };
  f.state.set(`${WAREHOUSE_PREFIX}issue:task-2`, { key: `${WAREHOUSE_PREFIX}issue:task-2`, value: JSON.stringify(other) });
  await assert.rejects(f.service.command('task-2', { ...issueInput, requestId: 'issue-other-request01', lines: [{ ...issueInput.lines[0], quantity: 61 }] }, warehouse), /既有发料/);
  await f.service.command('task-2', { ...issueInput, requestId: 'issue-other-request02', lines: [{ ...issueInput.lines[0], quantity: 60 }] }, warehouse);
  assert.equal(f.balance.availableQty.toNumber(), 100);
});

function checkInput(f: ReturnType<typeof fixture>, overrides: Partial<WarehouseReconcileInput> = {}): WarehouseReconcileInput {
  return { requestId: 'manual-check-request01', version: f.current().version, eventId: f.current().history[0].id, reason: '已查看 T+ 生效出库单及附件，逐项核对', voucherNumber: 'CLCK-20260916-001', posted: true, detailsMatch: true, lines: [{ code: 'V01', voucherLine: '1', quantity: 40, voucherQuantity: 40 }], ...overrides };
}
test('独立权限才能核对，40件对30件保存差异且不释放占用；修正后只记一次人工核对', async () => {
  const f = fixture(); await f.service.command('task-1', issueInput, warehouse);
  await assert.rejects(f.service.reconcile('task-1', checkInput(f), warehouse), /独立/);
  const difference = checkInput(f, { lines: [{ code: 'V01', voucherLine: '1', quantity: 30, voucherQuantity: 30 }] });
  await f.service.reconcile('task-1', difference, checker);
  assert.equal(f.current().history.at(-1)!.reconciliation!.result, 'difference');
  assert.equal(f.current().lines[0].issuedQty, 40);
  const matched = checkInput(f, { requestId: 'manual-check-request02' });
  await f.service.reconcile('task-1', matched, checker); await f.service.reconcile('task-1', matched, checker);
  assert.equal(f.current().history.length, 3); assert.equal(f.current().history.at(-1)!.reconciliation!.result, 'matched');
  assert.equal(f.current().history.at(-1)!.actorId, 'checker'); assert.equal(f.current().history.at(-1)!.reconciliation!.method, 'manual');
  assert.equal(f.balance.availableQty.toNumber(), 100);
  await assert.rejects(f.service.reconcile('task-1', { ...matched, reason: '改变内容' }, checker), /提交标识/);
  await assert.rejects(f.service.reconcile('task-1', checkInput(f, { requestId: 'manual-check-request03' }), checker), /先撤回/);
});
test('核对后旧库存快照仍占用，新同步才解除；撤回核对保留历史并恢复待核对', async () => {
  const f = fixture(); await f.service.command('task-1', issueInput, warehouse);
  await f.service.reconcile('task-1', checkInput(f), checker);
  const checkedAt = f.current().history.at(-1)!.at;
  const other = { ...f.current(), id: 'task-2', taskId: 'task-2', version: 1, history: [], lines: [{ code: 'V01', name: '阀体', unit: '件', quantity: 100 }] };
  f.state.set(`${WAREHOUSE_PREFIX}issue:task-2`, { key: `${WAREHOUSE_PREFIX}issue:task-2`, value: JSON.stringify(other) });
  f.balance.availableQty = new Prisma.Decimal(60);
  f.balance.syncedAt = new Date(checkedAt);
  const next = { ...issueInput, requestId: 'next-task-issue-request', lines: [{ ...issueInput.lines[0], quantity: 30 }] };
  await assert.rejects(f.service.command('task-2', next, warehouse), /库存不足/);
  f.balance.syncedAt = new Date(new Date(checkedAt).getTime() + 1);
  await f.service.command('task-2', next, warehouse);
  await f.service.reconcile('task-1', checkInput(f, { requestId: 'manual-revoke-request1', revoke: true, reason: 'T+ 凭证已冲销，重新核对' }), checker);
  assert.equal(f.current().history.at(-1)!.reconciliation!.result, 'revoked'); assert.equal(f.current().history[1].reconciliation!.result, 'matched');
  await assert.rejects(f.service.command('task-2', { ...next, version: 2, requestId: 'next-task-issue-request2', lines: [{ ...next.lines[0], quantity: 1 }] }, warehouse), /库存不足/);
});
test('凭证可以分批核销但累计不能超额；改变总数或物料不能绕过重复核销', async () => {
  const f = fixture(); await f.service.command('task-1', issueInput, warehouse);
  await f.service.reconcile('task-1', checkInput(f, { lines: [{ code: 'V01', voucherLine: '1', quantity: 40, voucherQuantity: 60 }] }), checker);
  await f.service.command('task-1', { ...issueInput, version: 3, requestId: 'second-issue-request01', lines: [{ ...issueInput.lines[0], quantity: 30 }] }, warehouse);
  const eventId = f.current().history.at(-1)!.id;
  await assert.rejects(f.service.reconcile('task-1', checkInput(f, { eventId, requestId: 'second-check-request01', lines: [{ code: 'V01', voucherLine: '1', quantity: 30, voucherQuantity: 60 }] }), checker), /不能重复/);
  await assert.rejects(f.service.reconcile('task-1', checkInput(f, { eventId, requestId: 'second-check-request02', lines: [{ code: 'V01', voucherLine: '1', quantity: 30, voucherQuantity: 70 }] }), checker), /总数量/);
  await assert.rejects(f.service.reconcile('task-1', checkInput(f, { eventId, requestId: 'second-check-request03', voucherNumber: 'clck-20260916-001', lines: [{ code: 'V01', voucherLine: '01', quantity: 30, voucherQuantity: 60 }] }), checker), /不能重复/);
  const g = fixture(); await g.service.command('task-1', issueInput, warehouse);
  await g.service.reconcile('task-1', checkInput(g, { lines: [{ code: 'V01', voucherLine: '1', quantity: 40, voucherQuantity: 60 }] }), checker);
  await g.service.command('task-1', { ...issueInput, version: 3, requestId: 'second-issue-request01', lines: [{ ...issueInput.lines[0], quantity: 20 }] }, warehouse);
  await g.service.reconcile('task-1', checkInput(g, { eventId: g.current().history.at(-1)!.id, requestId: 'second-check-request01', lines: [{ code: 'V01', voucherLine: '1', quantity: 20, voucherQuantity: 60 }] }), checker);
  assert.equal(g.current().history.at(-1)!.reconciliation!.result, 'matched');
});
test('未生效或明细不符不算核对完成；全部签收且核对一致后退出待办，撤回则返回', async () => {
  const f = fixture(); await f.service.command('task-1', { ...issueInput, lines: [{ ...issueInput.lines[0], quantity: 100 }] }, warehouse);
  const lines = [{ code: 'V01', voucherLine: '1', quantity: 100, voucherQuantity: 100 }];
  await f.service.reconcile('task-1', checkInput(f, { lines, posted: false }), checker);
  assert.equal(f.current().history.at(-1)!.reconciliation!.result, 'difference');
  await f.service.reconcile('task-1', checkInput(f, { lines, detailsMatch: false, requestId: 'manual-check-request02' }), checker);
  assert.equal(f.current().history.at(-1)!.reconciliation!.result, 'difference');
  await f.service.reconcile('task-1', checkInput(f, { lines, requestId: 'manual-check-request03' }), checker);
  assert.equal((await f.service.list({}, checker)).items.length, 1, '仍待签收');
  await f.service.command('task-1', { action: 'sign', version: f.current().version, requestId: 'sign-complete-request', reason: '清点100件', lines: [{ code: 'V01', quantity: 100 }] }, worker);
  assert.equal((await f.service.list({}, checker)).items.length, 0);
  assert.equal((await f.service.list({ status: 'all' }, worker)).items.length, 1);
  await f.service.reconcile('task-1', checkInput(f, { requestId: 'revoke-complete-request', revoke: true, reason: '凭证错误需更正' }), checker);
  assert.equal((await f.service.list({}, checker)).items.length, 1);
});
test('核对拒绝遗漏物料、重复行、负数、超额和旧版本', async () => {
  const f = fixture(); await f.service.command('task-1', issueInput, warehouse);
  for (const lines of [[], [{ code: 'OTHER', voucherLine: '1', quantity: 40, voucherQuantity: 40 }], [{ code: 'V01', voucherLine: '1', quantity: -1, voucherQuantity: 40 }], [{ code: 'V01', voucherLine: '1', quantity: 41, voucherQuantity: 40 }], [...checkInput(f).lines!, ...checkInput(f).lines!]]) await assert.rejects(f.service.reconcile('task-1', checkInput(f, { lines }), checker));
  await assert.rejects(f.service.reconcile('task-1', checkInput(f, { version: 1 }), checker), /已更新/);
  assert.equal(f.current().history.length, 1);
});

test('库存同步采用查询开始时间，慢查询落库不冒充核对后的新快照', async () => {
  const writes: any[] = []; let queriedAt = 0;
  const service = Object.create(TplusSyncService.prototype);
  service.fetchAllPages = async () => { queriedAt = Date.now(); await new Promise((resolve) => setTimeout(resolve, 15)); return []; };
  service.mapInventory = () => [{ inventoryCode: 'V01', warehouse: '量产仓', unit: '件', name: '阀体', stockQty: 60 }];
  service.prisma = { procMaterial: { findUnique: async () => ({ id: 'm1' }) }, procInventoryBalance: { upsert: async (args: any) => { writes.push(args); } }, runtimeState: { upsert: async () => ({}) } };
  await service.syncInventory();
  assert.equal(writes.length, 1); assert.ok(writes[0].create.syncedAt.getTime() <= queriedAt); assert.equal(writes[0].update.syncedAt.getTime(), writes[0].create.syncedAt.getTime());
});
