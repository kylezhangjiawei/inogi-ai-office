import * as assert from 'node:assert/strict';
import { test } from 'node:test';
import { Prisma } from '@prisma/client';
import { ErpPurchaseReceiptService, ERP_RECEIPT_PERMISSION } from '../src/modules/procurement/erp-purchase-receipt.service';
import { warehouseRecordKey } from '../src/modules/procurement/warehouse-records.service';
import { TplusSyncService } from '../src/modules/procurement/tplus-sync.service';
const d = (v: number) => new Prisma.Decimal(v);
const actor = { id: 'warehouse-1', name: '仓管甲', permissions: ['page:warehouse-flow', ERP_RECEIPT_PERMISSION] };
const input = () => ({ requestId: 'receipt-request-12345', recordId: 'R1', expectedVersion: 1, warehouseCode: 'W1', date: '2026-09-29', reason: '检验合格，按送货单办理' });
function fixture() {
  const state = new Map<string, string>(), writes: any[] = [], audits: any[] = [], locks: string[] = [];
  const record = { id: 'R1', version: 1, kind: 'receipt', status: 'confirmed', code: 'M1', unit: '件', warehouse: '原料仓', quantity: 10, qualifiedQty: 6, defectiveQty: 1, pendingQty: 3, sourceId: 'receipt-1', stockBatchNo: 'B1' };
  const line: any = { id: 'L1', tpOrderId: 'ERP-PO-1', tpOrderNo: 'PO1', tpLineNo: '1', inventoryCode: 'M1', inventoryName: '阀体', spec: 'V1', unit: '件', supplierName: '供应商甲', orderedQty: d(20), receivedQty: d(0) };
  const receipt: any = { id: 'receipt-1', lineId: 'L1', receivedQty: d(10), version: 1, sourceOrderId: line.tpOrderId, sourceOrderNo: 'PO1', sourceLineNo: '1', sourceInventoryCode: 'M1', sourceInventoryName: '阀体', sourceSpec: 'V1', sourceUnit: '件', sourceSupplierName: line.supplierName, sourceOrderedQty: d(20), inspections: [{qualifiedQty: d(6), defectiveQty: d(1), pendingJudgmentQty: d(2)}] };
  line.receipts = [receipt]; receipt.line = line;
  const order: any = { ID: 'ERP-PO-1', Code: 'PO1', Partner: { Code: 'S1', Name: line.supplierName }, Currency: { Code: 'RMB' }, ExchangeRate: '1', PurchaseOrderDetails: [{ID: 55, RowNo: 1, Inventory: {Code: 'M1'}, Unit: {Name: '件'}, Quantity: '20', CountQuantity: '0', OrigTaxPrice: '11.3', TaxRate: '0.13'}] };
  state.set(warehouseRecordKey('R1'), JSON.stringify(record));
  const remotes = new Map<string, any>(); let failAudit = false;
  const db: any = {
    runtimeState: {
      findUnique: async({where}: any) => state.has(where.key) ? {key: where.key, value: state.get(where.key)} : null,
      findMany: async({where}: any) => [...state].filter(([key]) => key.startsWith(where.key.startsWith)).map(([key,value]) => ({key,value})),
      upsert: async({where,create,update}: any) => { state.set(where.key, state.has(where.key) ? update.value : create.value); },
      update: async({where,data}: any) => { state.set(where.key,data.value); },
    }, procPurchaseReceipt: {findUnique: async() => receipt},
    auditLog: { create: async({data}: any) => {if(failAudit) throw Error('audit unavailable'); audits.push(data);} },
    $executeRaw: async(_strings: any, key: string) => {locks.push(key);}, $queryRaw: async() => [],
  };
  // The outer lock transaction deliberately has no writes. Inner verification is atomic.
  const tails = new Map<string, Promise<void>>();
  db.$transaction = async(fn: any) => {
    const before = new Map(state), count = audits.length, releases: Array<() => void> = [];
    const tx = {...db, $executeRaw: async(_strings: any, key: string) => {
      locks.push(key); const previous = tails.get(key) ?? Promise.resolve();
      tails.set(key, new Promise<void>(resolve => {releases.push(resolve);})); await previous;
    }};
    try {return await fn(tx);} catch(e) { if ((e as Error).message === 'audit unavailable') {state.clear(); for(const [k,v] of before) state.set(k,v); audits.length=count;} throw e;} finally {releases.forEach(release => release());}
  };
  const sync: any = {
    readErpWarehouses: async() => [{code:'W1',name:'原料仓'}], readErpPurchaseOrder: async() => order,
    createErpPurchaseReceipt: async(payload: any) => { writes.push(structuredClone(payload)); const dto = payload.dto; remotes.set(dto.ExternalCode, {...structuredClone(dto), PurchaseOrderCode: 'PO1', ID: 'ERP-RI-' + writes.length, Code: 'RI-' + writes.length, VoucherState: {Code:'00',Name:'未审'}}); return {code:0,data:{Code:'RI-'+writes.length}}; },
    readErpPurchaseReceipt: async({externalCode}: any) => {if(!remotes.has(externalCode)) throw Error('尚未找到'); return remotes.get(externalCode);},
  };
  return { service: new ErpPurchaseReceiptService(db,sync), sync, state, record, receipt, order, remotes, writes, audits, locks,
    saveRecord: () => state.set(warehouseRecordKey('R1'),JSON.stringify(record)), failAudit: (v: boolean) => {failAudit=v;} };
}
test('创建只发送合格数量、ERP 仓库及来源行，单据保持未审，不修改本地库存或交接记录', async() => {
  const f = fixture(), before = f.state.get(warehouseRecordKey('R1'));
  const result = await f.service.create(input(),actor), dto = f.writes[0].dto;
  assert.equal(dto.RDRecordDetails[0].Quantity,6); assert.equal(dto.RDRecordDetails[0].sourceVoucherDetailId,55);
  assert.equal(dto.RDRecordDetails[0].idsourcevouchertype,27); assert.equal(dto.RDRecordDetails[0].TaxRate,13);
  assert.equal(dto.RDRecordDetails[0].Batch,'B1'); assert.equal(result.result?.approvalStatus,'未审');
  assert.equal(f.state.get(warehouseRecordKey('R1')),before); assert.equal(f.audits.length,1);
  assert.ok(f.locks.includes('erp-purchase-receipt:v1:R1'));
});
test('仅新增和查询的受限网关，不允许审核、弃审或动态路径', async() => {
  const service: any = Object.create(TplusSyncService.prototype), calls: string[] = [];
  service.postTplus = async(path: string) => {calls.push(path); return {data:{ID:1,Code:'RI1',RDRecordDetails:[]}};};
  await service.createErpPurchaseReceipt({dto:{}}); await service.readErpPurchaseReceipt({externalCode:'X'});
  assert.deepEqual(calls,['/tplus/api/v2/PurchaseReceiveOpenApi/Create','/tplus/api/v2/PurchaseReceiveOpenApi/GetVoucherDTO']);
});
test('页面和独立 ERP 写权限缺一不可，拒绝发生在 ERP 请求前', async() => {
  const f = fixture();
  for(const permissions of [[],['page:warehouse-flow'],[ERP_RECEIPT_PERMISSION],['page:warehouse-flow','warehouse:receive']]) await assert.rejects(f.service.create(input(),{...actor,permissions}),/权限/);
  assert.equal(f.writes.length,0);
});
test('同一请求重放一次；其他用户或新请求不能重复创建已同步数量', async() => {
  const f=fixture(); await f.service.create(input(),actor); await f.service.create(input(),actor);
  await assert.rejects(f.service.create({...input(),reason:'换内容'},actor),/标识/);
  await assert.rejects(f.service.create({...input(),requestId:'another-request-12345'},{...actor,id:'warehouse-2'}),/没有尚未同步/);
  assert.equal(f.writes.length,1); assert.equal(f.audits.length,1);
});
test('响应丢失但 ERP 已创建可回读恢复；结果未知时任何重试都不重发', async() => {
  const f=fixture(), send=f.sync.createErpPurchaseReceipt;
  f.sync.createErpPurchaseReceipt=async(payload: any) => {await send(payload);throw Error('网络超时');};
  await f.service.create(input(),actor); assert.equal(f.writes.length,1);
  const g=fixture(); let calls=0; g.sync.createErpPurchaseReceipt=async() => {calls++;throw Error('超时');};
  await assert.rejects(g.service.create(input(),actor),/待核对/); await assert.rejects(g.service.create(input(),actor),/待核对/);
  await assert.rejects(g.service.create({...input(),requestId:'another-request-12345'},actor),/先刷新/);
  await assert.rejects(g.service.refresh('R1',actor),/待核对/); assert.equal(calls,1);
});
test('两个操作人同时创建时共享记录锁，只有一笔 ERP 创建', async() => {
  const f=fixture();const results=await Promise.allSettled([f.service.create(input(),actor),f.service.create({...input(),requestId:'parallel-request-12345'},{...actor,id:'warehouse-2'})]);
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(f.writes.length,1);assert.equal(f.audits.length,1);
});
test('崩溃后保留已提交意图，通过刷新恢复，无须原操作人再次创建', async() => {
  const f=fixture(); await f.service.create(input(),actor);
  const key=[...f.state.keys()].find(k=>k.startsWith('erp-purchase-receipt:'))!;
  const j=JSON.parse(f.state.get(key)!); j.state='sending'; delete j.result; f.state.set(key,JSON.stringify(j)); f.audits.length=0;
  const rows=await f.service.refresh('R1',{...actor,id:'warehouse-2',permissions:['page:warehouse-flow']});
  assert.equal(rows[0].state,'verified'); assert.equal(f.writes.length,1); assert.equal(f.audits.length,1);
});
test('后续补判合格只创建差额；审核状态按 ERP 回读，不因创建成功推断已审', async() => {
  const f=fixture();await f.service.create(input(),actor);
  f.record.version=2; f.record.qualifiedQty=8; f.record.pendingQty=1; f.receipt.inspections[0].qualifiedQty=d(8); f.receipt.inspections[0].pendingJudgmentQty=d(0); f.saveRecord();
  await f.service.create({...input(),expectedVersion:2,requestId:'later-request-12345'},actor);
  assert.equal(f.writes[1].dto.RDRecordDetails[0].Quantity,2);
  const first=[...f.remotes.values()][0]; first.VoucherState={Code:'01',Name:'已审'}; first.Auditor='ERP审核人';
  const rows=await f.service.refresh('R1',actor); assert.equal(rows.find(r=>r.quantity===6)?.result?.approvalStatus,'已审');
  assert.equal(f.writes.length,2); assert.equal(f.audits.length,2);
});
test('拒绝过期版本、仓库错配、ERP 来源行/单位/供应商/剩余数量变化和未检验数量', async() => {
  for(const change of [(f:any)=>{f.record.version=2;f.saveRecord();},(f:any)=>{f.record.warehouse='另一仓';f.saveRecord();},(f:any)=>{f.order.PurchaseOrderDetails[0].Inventory.Code='M2';},(f:any)=>{f.order.PurchaseOrderDetails[0].Unit.Name='箱';},(f:any)=>{f.order.Partner.Code='';},(f:any)=>{f.order.PurchaseOrderDetails[0].CountQuantity=19;},(f:any)=>{f.record.qualifiedQty=0;f.receipt.inspections[0].qualifiedQty=d(0);f.saveRecord();}]) {
    const f=fixture();change(f);await assert.rejects(f.service.create(input(),actor));assert.equal(f.writes.length,0);
  }
});
test('ERP 明确拒绝可更正重新提交；ERP 回读内容错配则保留待核对并阻止再创建', async() => {
  const f=fixture(), send=f.sync.createErpPurchaseReceipt;
  f.sync.createErpPurchaseReceipt=async()=>{throw Object.assign(Error('ERP业务拒绝'),{erpRejected:true});};
  await assert.rejects(f.service.create(input(),actor),/ERP业务拒绝/);assert.equal((await f.service.list(actor))[0].state,'rejected');
  f.sync.createErpPurchaseReceipt=send;await f.service.create({...input(),requestId:'corrected-request-123'},actor);assert.equal(f.writes.length,1);
  const g=fixture(), read=g.sync.readErpPurchaseReceipt;g.sync.readErpPurchaseReceipt=async(p:any)=>({...await read(p),Warehouse:{Code:'W2'}});
  await assert.rejects(g.service.create(input(),actor),/不一致/); await assert.rejects(g.service.create({...input(),requestId:'new-request-12345'},actor),/先刷新/);assert.equal(g.writes.length,1);
});
test('ERP 保存成功但本地审计失败时可恢复，成功审计与创建各一次', async() => {
  const f=fixture();f.failAudit(true);await assert.rejects(f.service.create(input(),actor),/待核对/);
  assert.equal((await f.service.list(actor))[0].state,'uncertain');f.failAudit(false);
  await f.service.refresh('R1',actor);assert.equal(f.writes.length,1);assert.equal(f.audits.length,1);
});

test('创建发送前凭据失败不占用数量，恢复后可重新提交且仍保留 ERP 审核', async() => {
  const f = fixture(), send = f.sync.createErpPurchaseReceipt;
  let reads = 0;
  const read = f.sync.readErpPurchaseReceipt;
  f.sync.readErpPurchaseReceipt = async (query: any) => { reads++; return read(query); };
  f.sync.createErpPurchaseReceipt = async () => { throw Object.assign(Error('凭据刷新失败'), { erpNotSent: true }); };
  await assert.rejects(f.service.create(input(), actor), /凭据刷新失败/);
  assert.equal((await f.service.list(actor))[0].state, 'rejected');
  assert.equal(reads, 0);
  assert.equal(f.writes.length, 0);
  f.sync.createErpPurchaseReceipt = send;
  await assert.rejects(f.service.create(input(), actor), /凭据刷新失败/);
  const result = await f.service.create({ ...input(), requestId: 'retry-after-token-fixed' }, actor);
  assert.equal(result.state, 'verified');
  assert.equal(result.quantity, 6);
  assert.equal(result.result?.approvalStatus, '未审');
  assert.equal(f.writes.length, 1);
  assert.equal(f.audits.length, 1);
});
