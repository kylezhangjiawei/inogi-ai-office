import * as assert from 'node:assert/strict';
import { test } from 'node:test';
import { TplusSyncService } from '../src/modules/procurement/tplus-sync.service';
import { ProcurementService } from '../src/modules/procurement/procurement.service';

function fixture() {
 const suppliers:any[]=[{id:'s1',name:'ＡＣＭＥ（中国）',tpCode:'S1',enabled:true,source:'tplus'}];
 const materials:any[]=[{id:'m1',name:'轴承',spec:'M8',unit:'件',tpInventoryCode:'M1',erpCode:'M1'}];
 const quotes:any[]=[];
 const states=new Map<string,string>();
 const table=(rows:any[])=>({findMany:async()=>rows.map(row=>({...row})),findUnique:async({where}:any)=>rows.find(r=>Object.entries(where).every(([k,v])=>r[k]===v))||null,
 create:async({data}:any)=>{const row={id:`id-${rows.length}`,metadata:{},...data};rows.push(row);return row;},
 updateMany:async({where,data}:any)=>{const matches=rows.filter(row=>Object.entries(where).every(([k,v])=>v===undefined||row[k]===v));matches.forEach(row=>Object.assign(row,data));return{count:matches.length};},
 update:async({where,data}:any)=>{const row=rows.find(r=>r.id===where.id);Object.assign(row,data);return row;}});
 const db:any={procSupplier:table(suppliers),procMaterial:table(materials),procSupplierQuote:table(quotes),$executeRaw:async()=>0,
 runtimeState:{findUnique:async({where}:any)=>states.has(where.key)?{value:states.get(where.key)}:null,
 upsert:async({where,create,update}:any)=>states.set(where.key,states.has(where.key)?update.value:create.value),
 update:async({where,data}:any)=>states.set(where.key,data.value)}};
 db.$transaction=async(fn:any)=>fn(db);
 db.$queryRaw=async()=>[];db.procMaterial.findUniqueOrThrow=db.procMaterial.findUnique;
 const service:any=new TplusSyncService(db,{} as never,{} as never,{} as never);
 const line={orderNo:'PO1',lineNo:'1',supplierName:' acme(中国) ',supplierCode:'S1',inventoryCode:'M1',inventoryName:'轴承',spec:'M8',unit:'件',orderedQty:20,receivedQty:0,unitPrice:12,currency:'CNY',taxIncluded:true,orderDate:'2026-09-01'};
 return {service,db,suppliers,materials,quotes,line};
}

test('不同ERP编码争用同一未编码物料时，后到写入不能覆盖先前绑定',async()=>{
 const f=fixture();Object.assign(f.materials[0],{tpInventoryCode:null,erpCode:''});
 const update=f.db.procMaterial.updateMany;
 f.db.procMaterial.updateMany=async(args:any)=>{Object.assign(f.materials[0],{tpInventoryCode:'OTHER',erpCode:'OTHER'});return update(args);};
 await assert.rejects(f.service.syncOrderQuoteLine(f.line),/已被其他操作更新/);
 assert.equal(f.materials[0].tpInventoryCode,'OTHER');assert.equal(f.quotes.length,0);
});

test('同步读取报价后发生人工改价，不会被订单参考价覆盖',async()=>{
 const f=fixture();await f.service.syncOrderQuoteLine(f.line);
 const update=f.db.procSupplierQuote.updateMany;
 f.db.procSupplierQuote.updateMany=async(args:any)=>{Object.assign(f.quotes[0],{source:'manual',tiers:[{minQty:0,unitPrice:99}]});return update(args);};
 await f.service.syncOrderQuoteLine({...f.line,orderDate:'2026-09-30',unitPrice:20});
 assert.equal(f.quotes[0].source,'manual');assert.equal(f.quotes[0].tiers[0].unitPrice,99);
});
test('订单补录按编码和规范名称去重，重复同步幂等且采购数量不当作MOQ',async()=>{
 const f=fixture();await f.service.syncOrderQuoteLine(f.line);await f.service.syncOrderQuoteLine(f.line);
 assert.equal(f.suppliers.length,1);assert.equal(f.materials.length,1);assert.equal(f.quotes.length,1);
 assert.equal(f.quotes[0].supplierId,'s1');assert.deepEqual(f.quotes[0].tiers,[{minQty:0,unitPrice:12}]);assert.equal(f.quotes[0].source,'tplus-order');
});

test('同名异码ERP供应商分别汇总物料与报价，重复同步不串价格',async()=>{
 const f=fixture(); f.suppliers.push({...f.suppliers[0],id:'s2',tpCode:'S2'});
 await f.service.syncOrderQuoteLine(f.line);
 await f.service.syncOrderQuoteLine({...f.line,supplierCode:'S2',unitPrice:22});
 await f.service.syncOrderQuoteLine(f.line);
 assert.equal(f.quotes.length,2); assert.deepEqual(f.quotes.map(q=>[q.supplierId,q.tiers[0].unitPrice]),[['s1',12],['s2',22]]);
 f.quotes[0].source='manual';await f.service.syncOrderQuoteLine({...f.line,orderDate:'2026-09-30',unitPrice:99});
 assert.equal(f.quotes[0].tiers[0].unitPrice,12);assert.equal(f.quotes[1].tiers[0].unitPrice,22);
});

test('新建异码同名供应商时保留未关联旧报价，不按名称挪用',async()=>{
 const f=fixture();const legacy={id:'legacy',materialId:'m1',supplierId:null,supplierName:f.suppliers[0].name,source:'manual',tiers:[{minQty:0,unitPrice:99}]};f.quotes.push(legacy);
 await f.service.syncOrderQuoteLine({...f.line,supplierCode:'S2'});
 await f.service.syncOrderQuoteLine(f.line);
 assert.equal(f.suppliers.length,2);assert.equal(f.quotes.length,3);
 assert.equal(legacy.supplierId,null);assert.equal(legacy.tiers[0].unitPrice,99);
 assert.equal(new Set(f.quotes.slice(1).map(q=>q.supplierId)).size,2);
});

test('唯一供应商可以关联未挂靠旧报价；已有档案报价时旧报价保持独立',async()=>{
 const f=fixture();f.quotes.push({id:'legacy',materialId:'m1',supplierId:null,supplierName:f.suppliers[0].name,source:'manual',tiers:[{minQty:0,unitPrice:99}]});
 await f.service.syncOrderQuoteLine(f.line);assert.equal(f.quotes.length,1);assert.equal(f.quotes[0].supplierId,'s1');assert.equal(f.quotes[0].tiers[0].unitPrice,99);
 f.quotes.push({id:'unlinked',materialId:'m1',supplierId:null,supplierName:f.suppliers[0].name,source:'manual',tiers:[]});
 await f.service.syncOrderQuoteLine(f.line);assert.equal(f.quotes.length,2);assert.equal(f.quotes[1].supplierId,null);
});
test('订单补充缺失供应商和物料；没有价格口径时保留物料但不伪造价格',async()=>{
 const f=fixture();await f.service.syncOrderQuoteLine({...f.line,supplierName:'新厂家',supplierCode:'S2',inventoryCode:'M2',inventoryName:'新物料',currency:undefined});
 assert.equal(f.suppliers.length,2);assert.equal(f.materials.length,2);assert.deepEqual(f.quotes[0].tiers,[]);
});
test('订单不会覆盖人工报价；旧订单不能覆盖较新的订单参考价',async()=>{
 const f=fixture();await f.service.syncOrderQuoteLine(f.line);await f.service.syncOrderQuoteLine({...f.line,orderDate:'2026-08-01',unitPrice:2});assert.equal(f.quotes[0].tiers[0].unitPrice,12);
 f.quotes[0].source='manual';await f.service.syncOrderQuoteLine({...f.line,orderDate:'2026-09-20',unitPrice:99});assert.equal(f.quotes[0].tiers[0].unitPrice,12);
});
test('无编码同名多档案报冲突，不随意关联；异码同名保持独立',async()=>{
 const f=fixture();f.suppliers.push({...f.suppliers[0],id:'s2',tpCode:'S2'});
 await assert.rejects(f.service.syncOrderQuoteLine({...f.line,supplierCode:undefined}),/歧义|多个/);
 await f.service.syncOrderQuoteLine({...f.line,supplierCode:'S3'});assert.equal(f.suppliers.length,3);
});
test('ERP物料发布缺少必要字段时不能请求ERP',async()=>{
 const f=fixture();let called=false;f.service.postTplus=async()=>{called=true;};
 await assert.rejects(f.service.publishMaterial('m1',{code:'',unitCode:'',categoryCode:'',valueType:'01'},'u1'),/填写/);assert.equal(called,false);
});

test('ERP发布确认回读后才关联；重复提交复用同编码档案',async()=>{
 const f=fixture();Object.assign(f.materials[0],{tpInventoryCode:null,erpCode:'',category:'五金'});
 const remote:any[]=[];const calls:any[]=[];
 f.service.fetchMaterialMasterRows=async()=>remote;
 f.service.postTplus=async(path:string,body:any)=>{calls.push({path,body});remote.push(body.dto);};
 const input={code:'NEW1',unitCode:'U1',categoryCode:'C1',valueType:'01'};
 await f.service.publishMaterial('m1',input,'u1');await f.service.publishMaterial('m1',input,'u1');
 assert.equal(calls.length,1);assert.equal(calls[0].path,'/tplus/api/v2/inventory/Create');assert.equal(calls[0].body.dto.Unit.Code,'U1');
 assert.equal(f.materials[0].tpInventoryCode,'NEW1');assert.equal(f.materials[0].metadata.tplusPublish.actorId,'u1');
});
test('ERP已创建但响应丢失时保留本地，重试先核查不重复创建',async()=>{
 const f=fixture();Object.assign(f.materials[0],{tpInventoryCode:null,erpCode:'',category:'五金'});
 const remote:any[]=[];let calls=0;f.service.fetchMaterialMasterRows=async()=>remote;
 f.service.postTplus=async(_path:string,body:any)=>{calls++;remote.push(body.dto);throw new Error('连接中断');};
 const input={code:'NEW1',unitCode:'U1',categoryCode:'C1',valueType:'01'};
 await assert.rejects(f.service.publishMaterial('m1',input,'u1'),/连接中断/);assert.equal(f.materials[0].tpInventoryCode,null);
 await f.service.publishMaterial('m1',input,'u1');assert.equal(calls,1);assert.equal(f.materials.length,1);assert.equal(f.materials[0].tpInventoryCode,'NEW1');
});

test('ERP单位或分类名称相同但编码不同，以及计价方式不同，不能关联成成功',async()=>{
 for(const patch of [{Unit:{Name:'件',Code:'U2'}},{InventoryClass:{Name:'五金',Code:'C2'}},{ValueType:{Code:'03'}}]){
  const f=fixture();Object.assign(f.materials[0],{tpInventoryCode:null,erpCode:'',category:'五金'});
  f.service.fetchMaterialMasterRows=async()=>[{Code:'NEW1',Name:'轴承',Specification:'M8',Unit:{Name:'件',Code:'U1'},InventoryClass:{Name:'五金',Code:'C1'},ValueType:{Code:'01'},...patch}];
  await assert.rejects(f.service.publishMaterial('m1',{code:'NEW1',unitCode:'U1',categoryCode:'C1',valueType:'01'},'u1'),/不同/);
  assert.equal(f.materials[0].tpInventoryCode,null);
 }
});

test('明确拒绝允许更正ERP编码；不明确结果只能查原请求，不得换码或重复创建',async()=>{
 const f=fixture();Object.assign(f.materials[0],{tpInventoryCode:null,erpCode:'',category:'五金'});
 const input={code:'NEW1',unitCode:'U1',categoryCode:'C1',valueType:'01'};let calls=0;
 f.service.fetchMaterialMasterRows=async()=>[];
 f.service.postTplus=async()=>{calls++;throw Object.assign(Error('拒绝'),{erpRejected:true});};
 await assert.rejects(f.service.publishMaterial('m1',input,'u1'),(error:any)=>error.getResponse().erpPublishRetry==='editable');
 f.service.postTplus=async()=>{calls++;throw Error('连接丢失');};
 const corrected={...input,code:'NEW2'};
 await assert.rejects(f.service.publishMaterial('m1',corrected,'u1'),(error:any)=>error.getResponse().erpPublishRetry==='same-input');
 await assert.rejects(f.service.publishMaterial('m1',input,'u1'),/原编码/);
 await assert.rejects(f.service.publishMaterial('m1',corrected,'u1'),/不会重复创建/);
 assert.equal(calls,2);
});

test('物料发布待核对时不能通过普通编辑改掉档案身份，但可以保留原信息再次核对',async()=>{
 const f=fixture();Object.assign(f.materials[0],{tpInventoryCode:null,erpCode:'',category:'五金'});
 f.service.fetchMaterialMasterRows=async()=>[];f.service.postTplus=async()=>{throw Error('响应丢失');};
 await assert.rejects(f.service.publishMaterial('m1',{code:'NEW1',unitCode:'U1',categoryCode:'C1',valueType:'01'},'u1'));
 const editor:any=new ProcurementService(f.db,{} as never,{} as never,{} as never);editor.serializeMaterial=(row:any)=>row;
 await assert.rejects(editor.upsertMaterial({name:'其他名称'},{id:'u1'},'m1'),/待核对/);
 await editor.upsertMaterial({name:'轴承',remark:'核对中'},{id:'u1'},'m1');assert.equal(f.materials[0].name,'轴承');
});

test('ERP明确返回创建失败时允许纠错，不冻结为结果不明',async()=>{
 const f=fixture();Object.assign(f.materials[0],{tpInventoryCode:null,erpCode:'',category:'五金'});
 f.service.fetchMaterialMasterRows=async()=>[];f.service.postTplus=async()=>({data:{Result:false}});
 await assert.rejects(f.service.publishMaterial('m1',{code:'NEW1',unitCode:'U1',categoryCode:'C1',valueType:'01'},'u1'),(error:any)=>error.getResponse().erpPublishRetry==='editable');
});
test('ERP编码已有不同物料或创建后无法回读时不伪称成功',async()=>{
 const f=fixture();Object.assign(f.materials[0],{tpInventoryCode:null,erpCode:'',category:'五金'});
 const input={code:'NEW1',unitCode:'U1',categoryCode:'C1',valueType:'01'};let calls=0;
 f.service.fetchMaterialMasterRows=async()=>[{Code:'NEW1',Name:'不同物料'}];f.service.postTplus=async()=>{calls++;};
 await assert.rejects(f.service.publishMaterial('m1',input,'u1'),/不同/);assert.equal(calls,0);
 f.service.fetchMaterialMasterRows=async()=>[];await assert.rejects(f.service.publishMaterial('m1',input,'u1'),/尚未查到/);assert.equal(f.materials[0].tpInventoryCode,null);
});
test('物料按编码匹配后补空缺，名称相同规格不同不合并',async()=>{
 const f=fixture();f.materials[0].unit='';await f.service.syncOrderQuoteLine(f.line);assert.equal(f.materials[0].unit,'件');
 await f.service.syncOrderQuoteLine({...f.line,inventoryCode:'M2',spec:'M10'});assert.equal(f.materials.length,2);assert.equal(f.materials[1].spec,'M10');
});
test('仅辅助联系方式相同不合并供应商；全半角名称支持补码',async()=>{
 const f=fixture();Object.assign(f.suppliers[0],{tpCode:null,phone:'123'});
 await f.service.syncOrderQuoteLine({...f.line,supplierPhone:'123'});assert.equal(f.suppliers.length,1);assert.equal(f.suppliers[0].tpCode,'S1');
 await f.service.syncOrderQuoteLine({...f.line,supplierCode:'S2',supplierName:'另一个法人',supplierPhone:'123'});assert.equal(f.suppliers.length,2);
});
test('报价库专用同步覆盖全部历史订单，并保留档案阶段错误',async()=>{
 const f=fixture();let days:number|undefined;
 f.service.syncSuppliers=async(report:(s:string)=>void)=>{report('同名冲突');return{upserted:3};};
 f.service.syncPurchaseOrderMirror=async(value:number)=>{days=value;return{orders:2,lines:3};};
 const result=await f.service.syncQuoteBook();assert.equal(days,0);assert.deepEqual(result.warnings,['同名冲突']);assert.equal(result.upserted,3);
});

test('新订单缺少价格口径时，不清空已有完整订单参考价',async()=>{
 const f=fixture();await f.service.syncOrderQuoteLine(f.line);
 await f.service.syncOrderQuoteLine({...f.line,orderDate:'2026-09-29',currency:undefined});
 assert.deepEqual(f.quotes[0].tiers,[{minQty:0,unitPrice:12}]);assert.equal(f.quotes[0].quoteDate.toISOString().slice(0,10),'2026-09-01');
});
test('ERP订单映射保留供应商编码、币种和原币含税价格',()=>{
 const f=fixture();const rows=f.service.mapVoucherLines({Code:'PO1',Partner:{Code:'S1',Name:'甲厂'},Currency:{Name:'人民币'},PurchaseOrderDetails:[{RowNo:2,Inventory:{Code:'M1',Name:'轴承'},Quantity:10,OrigTaxPrice:12,OrigPrice:10,Unit:{Name:'件'}}]});
 assert.equal(rows[0].supplierCode,'S1');assert.equal(rows[0].currency,'CNY');assert.equal(rows[0].unitPrice,12);assert.equal(rows[0].taxIncluded,true);
});
