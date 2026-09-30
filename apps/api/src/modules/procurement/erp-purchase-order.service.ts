import { createHash } from 'node:crypto';
import { BadRequestException, ConflictException, ForbiddenException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { TplusSyncService } from './tplus-sync.service';
import type { ProcActor } from './procurement.types';
import { createOrderPayload, erpOrderView, objectOf, orderMatches, updateOrderPayload, validateOrderWrite, type OrderWrite } from './erp-purchase-order';

export const ERP_ORDER_WRITE_PERMISSION = 'proc-purchase-order:write-erp';
const prefix = (actor: ProcActor) => `erp-po-request:${actor.id}:`;
type Journal = {input:OrderWrite;fingerprint:string;externalCode:string;state:'sending'|'uncertain'|'rejected'|'confirmed'|'verified';before?:Record<string,any>;orderNo?:string;error?:string;result?:{orderNo:string;deleted:boolean;warnings:string[]};};
@Injectable()
export class ErpPurchaseOrderService {
 constructor(private readonly prisma:PrismaService,private readonly sync:TplusSyncService) {}
 private permission(actor:ProcActor,write=true) {
  if (!actor.id || !actor.permissions.includes('*') && (!['page:purchase-orders','page:purchase-order-detail'].some(p=>actor.permissions.includes(p)) || (write ? !actor.permissions.includes(ERP_ORDER_WRITE_PERMISSION) : !actor.permissions.includes(ERP_ORDER_WRITE_PERMISSION)&&!actor.permissions.includes('proc:sync-erp')))) throw new ForbiddenException('需要采购订单页面及ERP订单操作权限');
 }
 private async journals(actor:ProcActor) { return (await this.prisma.runtimeState.findMany({where:{key:{startsWith:prefix(actor)}},orderBy:{updatedAt:'desc'}})).map(row=>JSON.parse(row.value) as Journal); }
 async options(actor:ProcActor) {
  this.permission(actor);
  const [suppliers,materials]=await Promise.all([
   this.prisma.procSupplier.findMany({where:{tpCode:{not:null},enabled:true},select:{id:true,tpCode:true,name:true},orderBy:{name:'asc'}}),
   this.prisma.procMaterial.findMany({where:{tpInventoryCode:{not:null}},select:{id:true,tpInventoryCode:true,name:true,spec:true,unit:true},orderBy:{name:'asc'}}),
  ]);return {suppliers,materials};
 }
 async requestStatus(requestId:string,actor:ProcActor) { this.permission(actor); const row=await this.prisma.runtimeState.findUnique({where:{key:prefix(actor)+requestId}});return row?JSON.parse(row.value) as Journal:null; }
 async pending(actor:ProcActor,orderNo?:string) { this.permission(actor);return (await this.journals(actor)).find(j=>['sending','uncertain','confirmed'].includes(j.state)&&(orderNo?j.input.orderNo===orderNo:j.input.action==='create')) ?? null; }
 async read(orderNo:string,actor:ProcActor) {
  this.permission(actor,false);
  const raw=await this.sync.readErpPurchaseOrder({voucherCode:orderNo});
  if (String(raw.Code)!==orderNo) throw new ConflictException('ERP返回了不同单据，已停止同步');
  let warnings:string[]=[];
  try { warnings=await this.sync.cacheErpPurchaseOrder(raw); } catch(error) { warnings.push(`ERP实时读取成功，本地同步待处理：${(error as Error).message}`); }
  return {...erpOrderView(raw),warnings};
 }
 private async localDependencies(orderNo:string,linesChanged:boolean) {
  if (!linesChanged) return;
  const [refs,rows]=await Promise.all([
   this.prisma.procPurchaseOrderRef.count({where:{tpOrderNo:orderNo}}),
   this.prisma.procPurchaseOrderMirror.findMany({where:{tpOrderNo:orderNo},include:{receipts:{select:{id:true}},stockPlanBatch:{select:{id:true}},availability:{select:{id:true}}}}),
  ]);
  if (refs || rows.some(row=>row.matchStatus==='confirmed'||row.receipts.length||row.stockPlanBatch||row.availability)) throw new ConflictException('订单已有任务关联、实收、备料或可用日期记录，不能删除订单或改动明细；可修改日期和备注');
 }
 private async save(key:string,journal:Journal) { await this.prisma.runtimeState.upsert({where:{key},create:{key,value:JSON.stringify(journal)},update:{value:JSON.stringify(journal)}}); }
 async write(rawInput:unknown,actor:ProcActor) {
  this.permission(actor);
  const input=validateOrderWrite(rawInput),key=prefix(actor)+input.requestId;
  const fingerprint=createHash('sha256').update(JSON.stringify(input)).digest('hex');
  // ponytail: low-frequency order writes serialize per actor/order while bounded ERP calls run.
  return this.prisma.$transaction(async lock=>{
   await lock.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'erp-po-actor:'+actor.id}))`;
   if(input.orderNo)await lock.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'erp-po-write:'+input.orderNo}))`;
   const stored=await this.prisma.runtimeState.findUnique({where:{key}});
   let journal:Journal|undefined=stored?JSON.parse(stored.value):undefined;
   if(journal&&journal.fingerprint!==fingerprint)throw new ConflictException('同一请求标识不能更换订单内容');
   if(journal?.state==='verified')return journal.result!;
   if(journal?.state==='rejected')throw new BadRequestException(journal.error||'ERP已拒绝该请求，请修改后重新提交');
   const pendingKey=input.orderNo?'erp-po-pending:'+input.orderNo:null;
   if(pendingKey){
    const pending=await this.prisma.runtimeState.findUnique({where:{key:pendingKey}});
    if(pending?.value && pending.value!==key)throw new ConflictException('该订单有其他操作结果待核对，请先恢复原请求');
   }
   if(!journal){
    if(input.action==='create'&&await this.pending(actor))throw new ConflictException('你有一张创建结果待核对的采购订单，请先恢复该请求');
    let before:Record<string,any>|undefined,payload:Record<string,unknown>;
    const externalCode='OFFICE-'+createHash('sha256').update(actor.id+':'+input.requestId).digest('hex').slice(0,40);
    if(input.action==='create')payload=createOrderPayload(input,externalCode);
    else {
     before=await this.sync.readErpPurchaseOrder({voucherCode:input.orderNo});const view=erpOrderView(before);
     if(view.orderNo!==input.orderNo||view.id!==input.expectedId||view.ts!==input.expectedTs)throw new ConflictException('ERP订单已被其他人修改，请重新读取后再操作');
     if(!view.editable)throw new ConflictException(view.restriction);
     const update=input.action==='update'?updateOrderPayload(input,before):undefined;
     await this.localDependencies(input.orderNo,input.action==='delete'||!!update?.dto.PurchaseOrderDetails.length);
     payload=update??{param:{voucherID:input.expectedId}};
    }
    journal={input,fingerprint,externalCode,state:'sending',before,orderNo:input.orderNo};
    // Commit intent outside the advisory-lock transaction BEFORE any external write. A timeout/crash never silently retries a Create.
    await this.prisma.$transaction(async tx=>{
     await tx.runtimeState.upsert({where:{key},create:{key,value:JSON.stringify(journal)},update:{value:JSON.stringify(journal)}});
     if(pendingKey)await tx.runtimeState.upsert({where:{key:pendingKey},create:{key:pendingKey,value:key},update:{value:key}});
    });
    try {
     const response=objectOf(await this.sync.writeErpPurchaseOrder(input.action,payload));
     const result=objectOf(response.data);
     if(result.Result===false||response.Result===false)throw Object.assign(new Error('ERP返回操作失败'),{erpRejected:true});
     journal.state='confirmed';journal.orderNo=String(result.Code||journal.orderNo||'');await this.save(key,journal);
    } catch(error) {
     const failure=error as {erpRejected?:boolean;erpNotSent?:boolean};
     journal.state=failure.erpRejected||failure.erpNotSent?'rejected':'uncertain';journal.error=(error as Error).message;
     // Ambiguous network outcomes are reconciled below without ever sending the write again.
     if(journal.state==='rejected'){
      await this.prisma.$transaction(async tx=>{
       await tx.runtimeState.update({where:{key},data:{value:JSON.stringify(journal)}});
       if(pendingKey)await tx.runtimeState.update({where:{key:pendingKey},data:{value:''}});
      });
      throw new BadRequestException(journal.error);
     }
     await this.save(key,journal);
    }
   }
   try {
    let orderNo=journal.orderNo||input.orderNo;let warnings:string[]=[];
    if(input.action==='delete') {
     if(await this.sync.erpPurchaseOrderExists(input.orderNo))throw new ConflictException('ERP中仍可查到订单，删除结果尚未确认');
     await this.localDependencies(input.orderNo,true);
     await this.prisma.$transaction(async tx=>{
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${'erp-po-mirror:'+input.orderNo}))::text`;
      await tx.runtimeState.upsert({where:{key:'erp-po-deleted:'+input.orderNo},create:{key:'erp-po-deleted:'+input.orderNo,value:input.expectedId},update:{value:input.expectedId}});
      await tx.procPurchaseOrderMirror.deleteMany({where:{tpOrderNo:input.orderNo,OR:[{tpOrderId:input.expectedId},{tpOrderId:null}]}});
     });
    } else {
     const after=await this.sync.readErpPurchaseOrder(input.action==='create'?{externalCode:journal.externalCode}:{voucherCode:input.orderNo});
     const view=erpOrderView(after);
     if(input.action==='create'&&view.externalCode!==journal.externalCode||input.action==='update'&&(view.id!==input.expectedId||view.orderNo!==input.orderNo)||!orderMatches(input,after))throw new ConflictException('ERP回读内容与本次提交不一致，尚未确认成功');
     orderNo=view.orderNo;warnings=await this.sync.cacheErpPurchaseOrder(after);
    }
    const result={orderNo,deleted:input.action==='delete',warnings};journal.state='verified';journal.result=result;journal.error=undefined;
    await this.prisma.$transaction(async tx=>{
     await tx.runtimeState.update({where:{key},data:{value:JSON.stringify(journal)}});
     if(pendingKey)await tx.runtimeState.update({where:{key:pendingKey},data:{value:''}});
     await tx.auditLog.create({data:{module:'procurement',source:'web',action:`purchase-order.erp-${input.action}`,resource:'proc-purchase-order',resourceId:orderNo,resourceName:orderNo,userId:actor.id,actorName:actor.name,summary:`ERP采购订单${{create:'新增',update:'修改',delete:'删除'}[input.action]}已核对`,meta:{requestId:input.requestId,before:journal!.before??null,input:input as unknown as Prisma.InputJsonValue,result}}});
    });
    return result;
   } catch(error) {
    journal.error=(error as Error).message;if(journal.state!=='confirmed')journal.state='uncertain';await this.save(key,journal);
    throw new ConflictException(`操作结果待核对：${journal.error}。请使用“核对上次操作”恢复；不会重复向ERP发送写入。`);
   }
  },{timeout:150_000,maxWait:10_000});
 }
}
