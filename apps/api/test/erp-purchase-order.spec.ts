import * as assert from 'node:assert/strict';
import { test } from 'node:test';
import { erpOrderView, validateOrderWrite, createOrderPayload, updateOrderPayload } from '../src/modules/procurement/erp-purchase-order';
const raw=()=>({ID:'9',Code:'PO9',Ts:'v1',VoucherDate:'2026-09-29',VoucherState:{Code:'00',Name:'未审'},Partner:{Code:'S1',Name:'厂家'},ContractId:'C9',Memo:'原备注',PurchaseOrderDetails:[{ID:'1',Ts:'l1',RowNo:1,Inventory:{Code:'M1',Name:'轴承'},Unit:{Code:'U1',Name:'件'},Quantity:2,CountQuantity:0,OrigDiscountPrice:10,TaxRate:0.13,AcceptDate:'2026-10-01'}]});
const input=()=>({requestId:'request-12345678',action:'create' as const,orderDate:'2026-09-29',supplierCode:'S1',contractNo:'C9',memo:'备注',lines:[{inventoryCode:'M1',unitName:'件',quantity:2,unitPrice:10,taxRate:13,etaDate:'2026-10-01'}]});
test('创建映射官方契约，外部单号固定，税率由百分数转小数',()=>{const value=validateOrderWrite(input());const body=createOrderPayload(value,'OFFICE-request-12345678');assert.equal(body.purchaseOrderDTO.ContractId,'C9');assert.equal(body.purchaseOrderDTO.ExternalCode,'OFFICE-request-12345678');assert.equal(body.purchaseOrderDTO.VoucherDetails[0].TaxRate,0.13);});
test('编辑只提交允许字段和行ID/Ts，不覆盖ERP隐藏字段',()=>{const view=erpOrderView(raw());const changed={...input(),action:'update',orderNo:'PO9',expectedId:'9',expectedTs:'v1',lines:[{...view.lines[0],quantity:3}]};const body=updateOrderPayload(validateOrderWrite(changed),raw());assert.equal(body.dto.Ts,'v1');assert.equal(body.dto.PurchaseOrderDetails[0].Ts,'l1');assert.equal(body.dto.PurchaseOrderDetails[0].Status,2);assert.equal((body.dto as any).Partner,undefined);});
test('拒绝非法日期、非有限数量和无物料明细',()=>{for(const patch of [{orderDate:'2026-02-30'},{lines:[]},{lines:[{...input().lines[0],quantity:Infinity}]}])assert.throws(()=>validateOrderWrite({...input(),...patch}));});
test('拒绝更改未公开的ERP字段，不能静默丢弃价格和供应商变化',()=>{const view=erpOrderView(raw());assert.throws(()=>updateOrderPayload(validateOrderWrite({...input(),action:'update',orderNo:'PO9',expectedId:'9',expectedTs:'v1',supplierCode:'S2',lines:view.lines}),raw()),/供应商/);});
import { ErpPurchaseOrderService, ERP_ORDER_WRITE_PERMISSION } from '../src/modules/procurement/erp-purchase-order.service';
import { lockOrderDependency } from '../src/modules/procurement/purchase-delivery-store';
import { TplusSyncService } from '../src/modules/procurement/tplus-sync.service';
const actor={id:'u1',name:'采购员',permissions:['page:purchase-orders',ERP_ORDER_WRITE_PERMISSION]};
function serviceFixture() {
 const state=new Map<string,string>(),audits:any[]=[],writes:any[]=[];let remote:any=raw(),refs=0,localRows:any[]=[];
 const db:any={
  $executeRaw:async()=>0,$queryRaw:async(strings:TemplateStringsArray,...keys:string[])=>strings.join('').includes('"RuntimeState"')?keys.filter(key=>state.get(key)).map(key=>({key})):[],
  runtimeState:{findUnique:async({where}:any)=>state.has(where.key)?{key:where.key,value:state.get(where.key)}:null,findMany:async({where}:any)=>[...state].filter(([key])=>key.startsWith(where.key.startsWith)).map(([key,value])=>({key,value})),
   upsert:async({where,create,update}:any)=>{state.set(where.key,state.has(where.key)?update.value:create.value);},update:async({where,data}:any)=>{state.set(where.key,data.value);}},
  procPurchaseOrderRef:{count:async()=>refs},procPurchaseOrderMirror:{findMany:async()=>localRows,deleteMany:async()=>{localRows=[];}},auditLog:{create:async({data}:any)=>audits.push(data)},
 };
 db.$transaction=async(fn:any)=>fn(db);
 const sync:any={readErpPurchaseOrder:async()=>{if(!remote)throw Error('未找到');return structuredClone(remote);},erpPurchaseOrderExists:async()=>!!remote,cacheErpPurchaseOrder:async()=>[],writeErpPurchaseOrder:async(action:string,payload:any)=>{
  writes.push({action,payload});if(action==='create'){const d=payload.purchaseOrderDTO;remote={...raw(),ExternalCode:d.ExternalCode,VoucherDate:d.VoucherDate,ContractId:d.ContractId,Memo:d.Memo,Partner:d.Partner,PurchaseOrderDetails:d.VoucherDetails.map((line:any,i:number)=>({...line,ID:String(i+1),Ts:'new',CountQuantity:0}))};}
  else if(action==='update'){remote.Memo=payload.dto.Memo;remote.VoucherDate=payload.dto.VoucherDate;for(const l of payload.dto.PurchaseOrderDetails)if(l.Status===2)Object.assign(remote.PurchaseOrderDetails.find((r:any)=>r.ID===l.ID),{Quantity:l.Quantity,Inventory:l.Inventory});remote.Ts='v2';}
  else remote=null;return{code:0,data:{Code:'PO9'}};
 }};
 return{service:new ErpPurchaseOrderService(db,sync),db,sync,writes,audits,state,get remote(){return remote;},set remote(v:any){remote=v;},set refs(v:number){refs=v;},set rows(v:any[]){localRows=v;}};
}
const edit=()=>{const r=raw(),v=erpOrderView(r);return{...input(),action:'update',orderNo:v.orderNo,expectedId:v.id,expectedTs:v.ts,lines:v.lines};};
test('ERP写入要求页面与专用权限同时满足，拒绝发生在ERP访问前',async()=>{
 const f=serviceFixture();for(const permissions of [[],['page:purchase-orders'],[ERP_ORDER_WRITE_PERMISSION],['page:purchase-orders','proc:sync-erp']])await assert.rejects(f.service.write(input(),{...actor,permissions}),/权限/);assert.equal(f.writes.length,0);
});
test('新增回读验证并写审计；相同请求重放不重复创建',async()=>{
 const f=serviceFixture();const first=await f.service.write(input(),actor);const again=await f.service.write(input(),actor);assert.deepEqual(first,again);assert.equal(f.writes.length,1);assert.equal(f.audits.length,1);assert.equal(first.orderNo,'PO9');
 await assert.rejects(f.service.write({...input(),memo:'换内容'},actor),/标识/);
});
test('创建响应丢失但ERP已保存时回读恢复，未保存时不盲目重发',async()=>{
 const f=serviceFixture();const send=f.sync.writeErpPurchaseOrder;f.sync.writeErpPurchaseOrder=async(...args:any[])=>{await send(...args);throw Error('超时');};await f.service.write(input(),actor);assert.equal(f.writes.length,1);
 const g=serviceFixture();g.remote=null;let calls=0;g.sync.writeErpPurchaseOrder=async()=>{calls++;throw Error('超时');};await assert.rejects(g.service.write(input(),actor),/待核对/);await assert.rejects(g.service.write(input(),actor),/待核对/);assert.equal(calls,1);
 await assert.rejects(g.service.write({...input(),requestId:'another-request-123'},actor),/上次|核对/);assert.ok(await g.service.pending(actor));
});
test('ERP成功但本地回写失败后可恢复，仅发送一次ERP写入',async()=>{
 const f=serviceFixture();let fail=true;f.sync.cacheErpPurchaseOrder=async()=>{if(fail){fail=false;throw Error('数据库暂时不可用');}return[];};await assert.rejects(f.service.write(input(),actor),/待核对/);await f.service.write(input(),actor);assert.equal(f.writes.length,1);assert.equal(f.audits.length,1);
});
test('修改拒绝过期版本、已审核、已到货订单；关联任务禁止明细变更但可维护备注',async()=>{
 const f=serviceFixture();await assert.rejects(f.service.write({...edit(),expectedTs:'old'},actor),/其他人/);
 f.remote.VoucherState.Code='01';await assert.rejects(f.service.write(edit(),actor),/未审/);f.remote=raw();f.remote.PurchaseOrderDetails[0].CountQuantity=1;await assert.rejects(f.service.write(edit(),actor),/未审/);
 f.remote=raw();f.refs=1;await assert.rejects(f.service.write({...edit(),lines:[{...erpOrderView(raw()).lines[0],quantity:3}]},actor),/关联/);await f.service.write(edit(),actor);assert.equal(f.writes.length,1);
});
test('删除按ID发起，ERP仍有单据时不删除本地；确认删除后留审计与旧快照阻断标记',async()=>{
 const f=serviceFixture();const payload={requestId:'delete-12345678',action:'delete',orderNo:'PO9',expectedId:'9',expectedTs:'v1'};
 f.sync.erpPurchaseOrderExists=async()=>true;await assert.rejects(f.service.write(payload,actor),/待核对/);assert.equal(f.audits.length,0);assert.deepEqual(f.writes[0].payload,{param:{voucherID:'9'}});
 f.sync.erpPurchaseOrderExists=async()=>false;await f.service.write(payload,actor);assert.equal(f.writes.length,1);assert.equal(f.state.get('erp-po-deleted:PO9'),'9');assert.equal(f.audits.length,1);
});
test('本地实收或备料记录禁止删除；业务拒绝保留可编辑失败状态',async()=>{
 const f=serviceFixture();f.rows=[{receipts:[{id:'receipt'}],stockPlanBatch:null,availability:null}];await assert.rejects(f.service.write({...edit(),action:'delete'},actor),/实收/);assert.equal(f.writes.length,0);
 const g=serviceFixture();g.sync.writeErpPurchaseOrder=async()=>{throw Object.assign(Error('ERP分类规则拒绝'),{erpRejected:true});};await assert.rejects(g.service.write(input(),actor),/ERP分类/);assert.equal((await g.service.requestStatus(input().requestId,actor))?.state,'rejected');assert.equal(await g.service.pending(actor),null);
});

test('ERP订单删除结果未确认期间阻止新依赖和其他人的订单操作，确认删除后继续阻止依赖',async()=>{
 const f=serviceFixture(),payload={requestId:'delete-12345678',action:'delete',orderNo:'PO9',expectedId:'9',expectedTs:'v1'};
 f.sync.erpPurchaseOrderExists=async()=>true;
 await assert.rejects(f.service.write(payload,actor),/待核对/);
 await assert.rejects(lockOrderDependency(f.db,'PO9'),/正在核对/);
 await assert.rejects(f.service.write({...edit(),requestId:'other-12345678'},{...actor,id:'other'}),/其他操作结果待核对/);
 f.sync.erpPurchaseOrderExists=async()=>false;await f.service.write(payload,actor);
 assert.equal(f.state.get('erp-po-pending:PO9'),'');
 await assert.rejects(lockOrderDependency(f.db,'PO9'),/已删除/);assert.equal(f.writes.length,1);
});

test('未发送到ERP的凭据失败可更正后创建，不会留下永久待核对请求',async()=>{
 const f=serviceFixture(),gateway:any=new TplusSyncService({} as never,{} as never,{} as never,{} as never);
 gateway.loadCredentials=async()=>null;
 const send=f.sync.writeErpPurchaseOrder;
 f.sync.writeErpPurchaseOrder=()=>gateway.postTplus('/create',{});
 await assert.rejects(f.service.write(input(),actor),/未配置/);
 assert.equal((await f.service.requestStatus(input().requestId,actor))?.state,'rejected');assert.equal(await f.service.pending(actor),null);
 f.sync.writeErpPurchaseOrder=send;
 await f.service.write({...input(),requestId:'corrected-12345678'},actor);assert.equal(f.writes.length,1);
});

test('明确拒绝的订单修改释放阻断标记，正常本地操作可以继续',async()=>{
 const f=serviceFixture();f.sync.writeErpPurchaseOrder=async()=>{throw Object.assign(Error('业务拒绝'),{erpRejected:true});};
 await assert.rejects(f.service.write(edit(),actor),/业务拒绝/);
 await lockOrderDependency(f.db,'PO9');assert.equal(f.state.get('erp-po-pending:PO9'),'');
});

test('ERP删除请求在途时本地新依赖必须等待，删除确认后不能落库',async()=>{
 const f=serviceFixture();const tails=new Map<string,Promise<void>>();
 f.db.$transaction=async(fn:any)=>{
  const releases:Array<()=>void>=[];
  const lock=async(strings:TemplateStringsArray,...values:string[])=>{
   if(strings.join('').includes('pg_advisory_xact_lock')){
    const key=values[0],before=tails.get(key)||Promise.resolve();let release!:()=>void;
    tails.set(key,new Promise<void>(resolve=>{release=resolve;}));await before;releases.push(release);return[];
   }
   return f.db.$queryRaw(strings,...values);
  };
  try{return await fn({...f.db,$queryRaw:lock,$executeRaw:lock});}finally{releases.reverse().forEach(release=>release());}
 };
 let finish!:()=>void,started!:()=>void;
 const inFlight=new Promise<void>(resolve=>{started=resolve;}),gate=new Promise<void>(resolve=>{finish=resolve;});
 const send=f.sync.writeErpPurchaseOrder;f.sync.writeErpPurchaseOrder=async(...args:any[])=>{started();await gate;return send(...args);};
 const deletion=f.service.write({...edit(),action:'delete'},actor);await inFlight;
 let inserted=false;
 const receipt=f.db.$transaction(async(tx:any)=>{await lockOrderDependency(tx,'PO9');inserted=true;});
 const rejected=assert.rejects(receipt,/已删除/);
 await new Promise(resolve=>setImmediate(resolve));assert.equal(inserted,false);
 finish();await deletion;await rejected;assert.equal(inserted,false);
});
