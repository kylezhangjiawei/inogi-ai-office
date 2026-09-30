import { authFetch, readErrorMessage } from './authSession';
export interface ErpOrderLine { id?:string;ts?:string;lineNo?:string;inventoryCode:string;name?:string;spec?:string;unitCode?:string;unitName:string;quantity:number;receivedQty?:number;unitPrice:number;taxRate:number;etaDate:string; }
export interface ErpOrderInput {requestId:string;action:'create'|'update'|'delete';orderNo:string;expectedId:string;expectedTs:string;orderDate:string;supplierCode:string;contractNo:string;memo:string;lines:ErpOrderLine[];}
export interface ErpOrderView {id:string;orderNo:string;ts:string;externalCode:string;orderDate:string;supplierCode:string;supplierName:string;contractNo:string;memo:string;approvalStatus:string;editable:boolean;restriction:string;lines:ErpOrderLine[];warnings:string[];}
export interface ErpOrderResult {orderNo:string;deleted:boolean;warnings:string[];}
export interface ErpOrderJournal {input:ErpOrderInput;state:'sending'|'uncertain'|'confirmed'|'verified'|'rejected';error?:string;result?:ErpOrderResult;}
export interface ErpOrderOptions {suppliers:{id:string;tpCode:string;name:string}[];materials:{id:string;tpInventoryCode:string;name:string;spec:string;unit:string}[];}
export class ErpOrderRequestError extends Error {constructor(message:string,public status:number){super(message);}}
async function request<T>(path:string,init?:RequestInit):Promise<T>{const response=await authFetch('/api/procurement/tplus/purchase-order-actions'+path,init);if(!response.ok)throw new ErpOrderRequestError(await readErrorMessage(response,'ERP订单操作失败'),response.status);return response.json();}
export const erpPurchaseOrderApi={
 options:()=>request<ErpOrderOptions>('/options'),
 read:(orderNo:string)=>request<ErpOrderView>('/'+encodeURIComponent(orderNo)),
 pending:(orderNo?:string)=>request<ErpOrderJournal|null>('/pending'+(orderNo?'?orderNo='+encodeURIComponent(orderNo):'')),
 status:(requestId:string)=>request<ErpOrderJournal|null>('/requests/'+encodeURIComponent(requestId)),
 write:(input:ErpOrderInput)=>request<ErpOrderResult>('',{method:'POST',body:JSON.stringify(input)}),
};
