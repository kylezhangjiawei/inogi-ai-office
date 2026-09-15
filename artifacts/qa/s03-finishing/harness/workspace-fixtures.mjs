import { createTasks, products, user as baseUser } from './task-fixtures.mjs';
export { products };
export const user = { ...baseUser, permissions: ['page:proc-my-workspace','page:proc-cockpit','page:purchase-orders','page:purchase-order-detail','proc-purchase-order:confirm-availability'] };
export function workspaceTasks(order) {
  const tasks=createTasks().map(task=>({...task,purchaseOrders:task.purchaseOrders.map(ref=>({...ref,tpOrderId:ref.tpOrderNo?`erp-${ref.tpOrderNo}`:null}))}));
  const template=tasks[5];
  tasks.push({...template,id:'qa-s08-dates',code:'PR-S08-DATES',materialName:'到货日期核对阀体（隔离演示）',materialId:null,spec:'按订单行核对，演示专用',needDate:'2026-09-20',expectedArrivalDate:'2026-09-13',purchaseOrders:order.items.map(line=>({id:`s08-ref-${line.lineNo}`,tpOrderId:'qa-erp-order',tpOrderNo:order.poNo,tpLineNo:line.lineNo,supplierName:order.supplier,orderedQty:line.qty,receivedQty:line.receivedQty,unitPrice:line.unitPrice,orderDate:order.orderDate,etaDate:line.etaDate})).concat([{id:'s08-ref-unresolved',tpOrderId:'qa-old-order',tpOrderNo:'QA-OLD-001',tpLineNo:null,supplierName:'待核对供应商（演示）',orderedQty:10,receivedQty:0,orderDate:order.orderDate,etaDate:'2026-09-14'},{id:'s08-ref-free',tpOrderNo:'',tpLineNo:'',freeSample:true,supplierName:'免费样品供应商（演示）',orderedQty:5,receivedQty:0,etaDate:null}])});
  return tasks;
}
export function arrivalDates(refIds,tasks,order){
 const refs=new Map(tasks.flatMap(task=>task.purchaseOrders.map(ref=>[ref.id,{task,ref}])));
 return {readOnly:true,items:[...new Set(refIds)].map(refId=>{
  const source=refs.get(refId); const unresolved=reason=>({refId,kind:'unresolved',reason});
  if(!source || source.task.buyerUserId!==user.id)return unresolved('关联记录不可用，请刷新任务后核对');
  const {task,ref}=source;
  if(ref.freeSample)return unresolved('免费样品没有可核对的正式订单行');
  if(!ref.tpLineNo)return unresolved('关联记录缺少订单行号，请在任务详情核对');
  const line=order.items.find(item=>item.lineNo===ref.tpLineNo && ref.tpOrderNo===order.poNo && ref.tpOrderId==='qa-erp-order');
  if(!line)return unresolved('关联订单行未同步或来源已变化，请核对');
  return {refId,kind:'line',taskId:task.id,tpOrderId:ref.tpOrderId,lineId:line.id,orderNo:order.poNo,lineNo:line.lineNo,inventoryCode:line.sku,inventoryName:line.name,unit:line.unit,supplierName:order.supplier,etaDate:line.etaDate,syncedAt:order.syncedAt,orderStatus:'已审批（演示）',approvalStatus:order.approvalStatus,availability:line.availability};
 })};
}
