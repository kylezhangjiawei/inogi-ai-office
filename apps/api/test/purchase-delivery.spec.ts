import * as assert from 'node:assert/strict';
import { test } from 'node:test';
import { PurchaseDeliveryService } from '../src/modules/procurement/purchase-delivery.service';
import { DELIVERY_WRITE_PERMISSION, deliveryKey, parseDeliveryState, persistMirrorDelivery, validateDeliveryDay } from '../src/modules/procurement/purchase-delivery-store';
type Row = Record<string, any>;
const stamp = new Date('2026-09-10T01:00:00.000Z');
const actor = { id: 'buyer-1', name: '采购甲', permissions: ['page:purchase-order-detail', DELIVERY_WRITE_PERMISSION] };
const line = (id = 'mirror-1', extra: Row = {}) => ({ id, tpOrderNo: 'PO-1', tpOrderId: 'erp-1', tpLineNo: id, inventoryCode: 'A01', inventoryName: '壳体', spec: '白色', unit: '件', orderedQty: 100, receivedQty: 20, unitPrice: 12, supplierName: '供应商甲', etaDate: new Date('2026-09-14T00:00:00.000Z'), orderDate: new Date('2026-09-01T00:00:00.000Z'), status: 'audited', approvalStatus: '已审核', updatedAt: stamp, syncedAt: stamp, ...extra });
const input = (extra: Row = {}) => ({ requestId: 'request_0000000001', orderNo: 'PO-1', promisedDate: '2026-09-15', communicatedOn: '2026-09-01', evidence: '供应商邮件编号 QA-1', reason: '首次凭据登记', declareOriginal: true, expectedVersion: 0, expectedSourceUpdatedAt: stamp.toISOString(), ...extra });
const match = (row: Row, where: Row = {}): boolean => Object.entries(where).every(([key, value]) => {
  if (key === 'AND') return (value as Row[]).every((item) => match(row, item));
  if (key === 'OR') return (value as Row[]).some((item) => match(row, item));
  if (value === null) return row[key] == null;
  if (typeof value !== 'object') return row[key] === value;
  const v = value as Row, actual = row[key];
  if (v.startsWith !== undefined) return typeof actual === 'string' && actual.startsWith(v.startsWith);
  if (v.in !== undefined) return v.in.includes(actual);
  if (v.contains !== undefined) return String(actual).toLowerCase().includes(v.contains.toLowerCase());
  if (actual == null) return false;
  return (v.gte === undefined || actual >= v.gte) && (v.lt === undefined || actual < v.lt);
});
function fixture(initial = [line()]) {
  let lines: Row[] = structuredClone(initial), states = new Map<string, Row>(); const audits: Row[] = [], locks: unknown[][] = [], queries: Row[] = []; let failAudit = false; let clock = 0; let tail = Promise.resolve();
  const nextTime = () => new Date(stamp.getTime() + ++clock * 1000);
  const slice = (rows: Row[], args: Row) => rows.slice(args.skip ?? 0, (args.skip ?? 0) + (args.take ?? rows.length));
  const max = (rows: Row[], key: string) => rows.map((r) => r[key]).filter(Boolean).sort((a,b) => b - a)[0] ?? null;
  const db: Row = {
    $queryRaw: async (_strings: TemplateStringsArray, ...values: unknown[]) => { locks.push(values); return []; },
    procPurchaseOrderMirror: {
      findFirst: async ({ where }: Row) => structuredClone(lines.find((row) => match(row, where)) ?? null),
      findUnique: async ({ where }: Row) => structuredClone(lines.find((row) => match(row, where.tpOrderNo_tpLineNo)) ?? null),
      findMany: async (args: Row) => { queries.push(args); return structuredClone(slice(lines.filter((row) => match(row, args.where)).sort((a,b) => (a.etaDate?.getTime() ?? Infinity) - (b.etaDate?.getTime() ?? Infinity) || a.id.localeCompare(b.id)), args)); },
      count: async ({ where }: Row) => lines.filter((row) => match(row, where)).length,
      aggregate: async ({ where }: Row) => { const rows = lines.filter((row) => match(row, where)); return { _count: { _all: rows.length }, _max: { updatedAt: max(rows, 'updatedAt'), syncedAt: max(rows, 'syncedAt') }, _min: { orderDate: rows.map((r) => r.orderDate).filter(Boolean).sort((a,b) => Number(a)-Number(b))[0] ?? null } }; },
      groupBy: async ({ where }: Row) => { const counts = new Map<number,number>(); for (const row of lines.filter((row) => match(row, where))) counts.set(row.etaDate.getTime(), (counts.get(row.etaDate.getTime()) ?? 0) + 1); return [...counts].map(([date, count]) => ({ etaDate: new Date(date), _count: { _all: count } })); },
      upsert: async ({ where, create, update }: Row) => { let row = lines.find((row) => match(row, where.tpOrderNo_tpLineNo)); if (row) Object.assign(row, update, { updatedAt: nextTime() }); else { row = { id: 'created-1', ...create, updatedAt: nextTime() }; lines.push(row!); } return structuredClone(row); },
    },
    runtimeState: {
      findUnique: async ({ where }: Row) => structuredClone(states.get(where.key) ?? null),
      findMany: async (args: Row) => { let rows = [...states.values()].filter((row) => match(row, args.where)); if (args.orderBy) rows.sort((a,b) => b.key.localeCompare(a.key)); return structuredClone(slice(rows,args)); },
      count: async ({ where }: Row) => [...states.values()].filter((row) => match(row, where)).length,
      aggregate: async ({ where }: Row) => ({ _max: { updatedAt: max([...states.values()].filter((row) => match(row,where)), 'updatedAt') } }),
      create: async ({ data }: Row) => { assert.ok(!states.has(data.key), 'immutable key must be unique'); const row = { ...data, updatedAt: nextTime() }; states.set(data.key,row); return structuredClone(row); },
      upsert: async ({ where, create, update }: Row) => { const row = { ...(states.get(where.key) ?? create), ...(states.has(where.key) ? update : {}), updatedAt: nextTime() }; states.set(where.key,row); return structuredClone(row); },
    },
    auditLog: { create: async ({ data }: Row) => { if (failAudit) throw new Error('audit unavailable'); audits.push(structuredClone(data)); return data; } },
    $transaction: async (run: (tx: any) => any) => { const prior = tail; let done!: () => void; tail = new Promise<void>((resolve) => { done = resolve; }); await prior; const before = { lines: structuredClone(lines), states: structuredClone(states), auditLength: audits.length }; try { return await run(db); } catch(error) { lines = before.lines; states = before.states; audits.length = before.auditLength; throw error; } finally { done(); } },
  };
  return { service: new PurchaseDeliveryService(db as never), db, audits, locks, queries, lines: () => lines, states: () => states, failAudit: () => { failAudit = true; } };
}

test('F11: supplier basis changes calendar day and preserves ERP; withdrawal returns to undated', async () => {
  const f = fixture(); await f.service.record('mirror-1', input(), actor);
  const latest = await f.service.schedule({ month: '2026-09', dateBasis: 'latest' }, actor);
  assert.deepEqual(latest.days, [{ date: '2026-09-15', count: 1 }]);
  assert.equal(latest.rows.items[0].erpExpectedDate, '2026-09-14');
  const old = await f.service.schedule({ month: '2026-09', dateBasis: 'latest', date: '2026-09-14' }, actor); assert.equal(old.rows.total, 0);
  await f.service.record('mirror-1', input({ requestId: 'withdrawal_00000002', declareOriginal: false, expectedVersion: 1, promisedDate: null }), actor);
  await assert.rejects(f.service.schedule({ month: '2026-09', dateBasis: 'latest', snapshot: latest.snapshot }, actor), /已更新/);
  const result = await f.service.schedule({ month: '2026-09', dateBasis: 'latest', bucket: 'undated' }, actor); assert.equal(result.rows.total, 1); assert.equal(result.days.length, 0);
  await assert.rejects(f.service.schedule({ month: '2026-09', dateBasis: 'unknown' }, actor), /口径/);
});
test('strict dates and complete input reject impossible dates, missing evidence, future communication and invalid versions', async () => {
  assert.equal(validateDeliveryDay('2028-02-29','日期'), '2028-02-29');
  for (const day of ['0000-01-01','2026-02-29','2026-04-31','2026-9-01',undefined]) assert.throws(() => validateDeliveryDay(day,'日期'));
  for (const changed of [{ promisedDate:'2026-02-30' }, { evidence:'' }, { reason:' ' }, { communicatedOn:'9999-01-01' }, { expectedVersion:'0' }, { expectedSourceUpdatedAt:'2026-02-30T00:00:00.000Z' }, { requestId:'short' }]) { const f = fixture(); await assert.rejects(f.service.record('mirror-1',input(changed) as never,actor)); assert.equal(f.locks.length,0); assert.equal(f.states().size,0); }
});
test('full order mirror read permissions; write requires detail page AND dedicated action', async () => {
  for (const permissions of [[], ['page:proc-my-workspace'], [DELIVERY_WRITE_PERMISSION]]) await assert.rejects(fixture().service.get('mirror-1',{orderNo:'PO-1'}, {...actor,permissions}),/权限/);
  for (const permissions of [[], ['page:purchase-order-detail'], [DELIVERY_WRITE_PERMISSION], ['page:purchase-orders', DELIVERY_WRITE_PERMISSION]]) await assert.rejects(fixture().service.record('mirror-1',input(),{...actor,permissions}),/权限/);
  assert.equal((await fixture().service.get('mirror-1',{orderNo:'PO-1'},{...actor,permissions:['page:purchase-orders']})).canRecord,false);
  assert.equal((await fixture().service.record('mirror-1',input(),{...actor,permissions:['*']})).supplier?.version,1);
});
test('exact line AND order identity rejects mismatched and missing records', async () => {
  for (const [id, orderNo] of [['mirror-1','wrong'],['wrong','PO-1']]) { const f = fixture(); await assert.rejects(f.service.get(id,{orderNo},actor),/不存在/); await assert.rejects(f.service.record(id,input({orderNo}),actor),/不存在/); assert.equal(f.states().size,0); }
});
test('original, revisions and withdrawal retain actor/version/first promise without modifying ERP', async () => {
  const f=fixture(), before=structuredClone(f.lines()); let result=await f.service.record('mirror-1',input(),actor);
  assert.equal(result.supplier?.originalDate,'2026-09-15'); assert.equal(result.supplierHistory.items[0].actorId,actor.id); assert.equal(f.audits[0].meta.evidence,'供应商邮件编号 QA-1');
  result=await f.service.record('mirror-1',input({requestId:'request_0000000002', expectedVersion:1, declareOriginal:false, promisedDate:'2026-09-20',reason:'供应商改期'}),actor); assert.equal(result.supplier?.originalDate,'2026-09-15'); assert.equal(result.supplier?.currentDate,'2026-09-20');
  result=await f.service.record('mirror-1',input({requestId:'request_0000000003',expectedVersion:2,declareOriginal:false,promisedDate:null}),actor); assert.equal(result.supplier?.currentDate,null); assert.equal(result.supplierHistory.items[0].kind,'withdrawal'); assert.deepEqual(result.supplierHistory.items.map((r)=>r.version),[3,2,1]); assert.deepEqual(f.lines(),before); assert.equal(f.audits.length,3);
});
test('unasserted first date leaves original unknown and later cannot invent original history', async () => {
  const f=fixture(); assert.equal((await f.service.record('mirror-1',input({declareOriginal:false}),actor)).supplier?.originalDate,null); await assert.rejects(f.service.record('mirror-1',input({requestId:'request_0000000002',expectedVersion:1}),actor),/仅首次/);
});
test('persistent retry deduplicates across service restart; altered request or actor conflicts', async () => {
  const f=fixture(); await f.service.record('mirror-1',input(),actor); const second=new PurchaseDeliveryService(f.db as never); assert.equal((await second.record('mirror-1',input(),actor)).supplier?.version,1); assert.equal(f.audits.length,1);
  await assert.rejects(second.record('mirror-1',input({reason:'changed'}),actor),/提交标识/); await assert.rejects(second.record('mirror-1',input(),{...actor,id:'other'}),/提交标识/); assert.ok(String(f.locks[0][0]).includes(':request:'));
});
test('concurrent same request commits once; different same-version changes have one winner', async () => {
  const f=fixture(); await Promise.all([f.service.record('mirror-1',input(),actor), f.service.record('mirror-1',input(),actor)]); assert.equal(f.audits.length,1);
  const g=fixture(); const outcomes=await Promise.allSettled([g.service.record('mirror-1',input(),actor),g.service.record('mirror-1',input({requestId:'request_0000000002'}),actor)]); assert.equal(outcomes.filter((r)=>r.status==='fulfilled').length,1); assert.equal(g.audits.length,1);
});
test('source conflicts preserve state and changed source identity flags old promise', async () => {
  const f=fixture(); await assert.rejects(f.service.record('mirror-1',input({expectedSourceUpdatedAt:'2026-09-10T01:00:01.000Z'}),actor),/已变化/); assert.equal(f.states().size,0);
  await f.service.record('mirror-1',input(),actor); f.lines()[0].tpOrderId='recreated'; assert.equal((await f.service.get('mirror-1',{orderNo:'PO-1'},actor)).supplier?.sourceChanged,true);
});
test('audit failure rolls back promise/history/dedup atomically', async () => { const f=fixture(); f.failAudit(); await assert.rejects(f.service.record('mirror-1',input(),actor),/audit/); assert.equal(f.states().size,0); assert.equal(f.audits.length,0); });
const syncData=(extra:Row={})=>{const data:Row={...line(),...extra}; delete data.id; delete data.tpOrderNo; delete data.tpLineNo;return data;};

test('ERP write reconciliation rejects deleted and older order snapshots, including a removed line', async () => {
  const f=fixture();
  await persistMirrorDelivery(f.db as never,'PO-1','mirror-1',syncData({metadata:{erpTs:'00000020'}}) as never);
  await assert.rejects(persistMirrorDelivery(f.db as never,'PO-1','new-line',syncData({metadata:{erpTs:'00000010'}}) as never), /旧快照/);
  assert.equal(f.lines().length,1);
  await f.db.runtimeState.upsert({where:{key:'erp-po-deleted:PO-1'},create:{key:'erp-po-deleted:PO-1',value:'erp-1'},update:{value:'erp-1'}});
  await assert.rejects(persistMirrorDelivery(f.db as never,'PO-1','mirror-1',syncData({metadata:{erpTs:'00000030'}}) as never), /已确认删除/);
  assert.equal(f.lines()[0].metadata.erpTs,'00000020');
});
test('ERP baseline, no-op sync and date clear retain only observed history', async () => {
  const f=fixture(); await persistMirrorDelivery(f.db as never,'PO-1','mirror-1',syncData() as never); let detail=await f.service.get('mirror-1',{orderNo:'PO-1'},actor); assert.equal(detail.erpHistory.items[0].kind,'baseline'); assert.equal(detail.erpHistory.items[0].before,null); const coverage=detail.erp?.coverageStartedAt;
  await persistMirrorDelivery(f.db as never,'PO-1','mirror-1',syncData({syncedAt:new Date()}) as never); assert.equal(f.audits.length,1);
  await persistMirrorDelivery(f.db as never,'PO-1','mirror-1',syncData({etaDate:null}) as never); detail=await f.service.get('mirror-1',{orderNo:'PO-1'},actor); assert.equal(detail.erpHistory.items[0].kind,'change'); assert.equal(detail.erpHistory.items[0].before,'2026-09-14'); assert.equal(detail.erpHistory.items[0].after,null); assert.equal(detail.erp?.coverageStartedAt,coverage);
});
test('first changed observation uses old mirror date, and audit failure rolls back mirror', async () => {
  const f=fixture(), data=syncData({etaDate:new Date('2026-09-18T00:00:00Z')}); await persistMirrorDelivery(f.db as never,'PO-1','mirror-1',data as never); const detail=await f.service.get('mirror-1',{orderNo:'PO-1'},actor); assert.equal(detail.erpHistory.total,1); assert.equal(detail.erpHistory.items[0].kind,'change'); assert.equal(detail.erpHistory.items[0].before,'2026-09-14');
  const g=fixture(), before=structuredClone(g.lines()); g.failAudit(); await assert.rejects(persistMirrorDelivery(g.db as never,'PO-1','mirror-1',data as never),/audit/); assert.deepEqual(g.lines(),before); assert.equal(g.states().size,0);
});
test('corrupt persisted state blocks replacement instead of fabricating empty history', async () => {
  for (const value of ['bad','{}','{"version":1}','{"version":1,"lastEntry":null}']) assert.throws(()=>parseDeliveryState(value),/格式异常/);
  const f=fixture(); f.states().set(deliveryKey('supplier','mirror-1'),{key:deliveryKey('supplier','mirror-1'),value:'{"version":1}',updatedAt:stamp}); await assert.rejects(f.service.record('mirror-1',input({expectedVersion:1}),actor),/格式异常/); assert.equal(f.states().size,1);
});
test('full-mirror calendar counts unlinked lines with stable pages, exact supplier and date scopes', async () => {
  const rows=Array.from({length:27},(_,i)=>line(`m-${String(i).padStart(2,'0')}`,{tpOrderNo:`PO-${i}`,etaDate:i===25?null:i===26?new Date('2026-10-01T00:00:00Z'):new Date('2026-09-14T00:00:00Z'),unit:i%2?'米':'件'}));
  const f=fixture(rows), first=await f.service.schedule({month:'2026-09',bucket:'all'},actor); assert.deepEqual(first.summary,{all:27,inMonth:25,undated:1,outside:1}); assert.deepEqual(first.days,[{date:'2026-09-14',count:25}]); assert.equal(first.rows.items.length,20);
  const second=await f.service.schedule({month:'2026-09',bucket:'all',page:2,snapshot:first.snapshot},actor); assert.equal(second.rows.items.length,7); assert.equal(new Set([...first.rows.items,...second.rows.items].map(r=>r.lineId)).size,27); assert.ok(f.queries.every(q=>!JSON.stringify(q).includes('task')));
  assert.equal((await f.service.schedule({month:'2026-09',bucket:'undated'},actor)).rows.total,1); assert.equal((await f.service.schedule({month:'2026-09',supplier:'供应商'},actor)).summary.all,0); assert.equal((await f.service.schedule({month:'2026-09',date:'2026-09-14',pageSize:50},actor)).rows.total,25);
});
test('changed source/account invalidates page token and bad ranges/pages fail', async () => {
  const f=fixture(), first=await f.service.schedule({month:'2026-09'},actor); f.lines()[0].updatedAt=new Date(stamp.getTime()+1); await assert.rejects(f.service.schedule({month:'2026-09',snapshot:first.snapshot},actor),/已更新/); await assert.rejects(f.service.schedule({month:'2026-09',snapshot:first.snapshot},{...actor,id:'buyer-2'}),/已更新/);
  for (const query of [{month:'0000-01'},{month:'2026-09',date:'2026-10-01'},{month:'2026-09',page:0},{month:'2026-09',bucket:'wrong'},{month:'2026-09',pageSize:100}]) await assert.rejects(f.service.schedule(query,actor));
});
test('immutable history pages preserve original beyond first ten versions', async () => {
  const f=fixture(); for (let i=0;i<12;i++) await f.service.record('mirror-1',input({requestId:`request_${String(i).padStart(16,'0')}`,expectedVersion:i,declareOriginal:i===0}),actor);
  const detail=await f.service.get('mirror-1',{orderNo:'PO-1',supplierPage:2},actor); assert.equal(detail.supplierHistory.total,12); assert.deepEqual(detail.supplierHistory.items.map(r=>r.version),[2,1]); assert.equal(detail.supplier?.originalDate,'2026-09-15');
});

test('review: reconfirming a changed supplier cannot assign the previous supplier original promise to the new source', async () => {
  const f = fixture(); await f.service.record('mirror-1', input(), actor);
  f.lines()[0].supplierName = '供应商乙'; f.lines()[0].updatedAt = new Date(stamp.getTime() + 1000);
  const updated = await f.service.record('mirror-1', input({ requestId: 'new-source-request-01', declareOriginal: false, expectedVersion: 1, expectedSourceUpdatedAt: f.lines()[0].updatedAt.toISOString(), promisedDate: '2026-09-18' }), actor);
  assert.equal(updated.supplier?.currentDate, '2026-09-18'); assert.equal(updated.supplier?.originalDate, null); assert.equal(updated.supplier?.sourceChanged, false);
  const original = updated.supplierHistory.items.find(row => row.version === 1)!;
  assert.equal(original.after, '2026-09-15'); assert.equal(original.source.supplierName, '供应商甲');
});
