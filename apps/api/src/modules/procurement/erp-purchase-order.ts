import { BadRequestException, ConflictException } from '@nestjs/common';

type Row = Record<string, any>;
export type OrderAction = 'create' | 'update' | 'delete';
export interface ErpOrderLine { id?: string; ts?: string; lineNo?: string; inventoryCode: string; name?: string; spec?: string; unitCode?: string; unitName: string; quantity: number; receivedQty?: number; unitPrice: number; taxRate: number; etaDate: string; }
export interface OrderWrite { requestId: string; action: OrderAction; orderNo: string; expectedId: string; expectedTs: string; orderDate: string; supplierCode: string; contractNo: string; memo: string; lines: ErpOrderLine[]; }
export const objectOf = (value: unknown): Row => value && typeof value === 'object' && !Array.isArray(value) ? value as Row : {};
const text = (value: unknown, field: string, max = 200, required = false) => { if (value == null && !required) return ''; if (typeof value !== 'string' || value.length > max || /[\u0000-\u001f\u007f]/.test(value) || required && !value.trim()) throw new BadRequestException(`${field}无效`); return value.trim(); };
const day = (value: unknown, required = false) => { const s = text(value, '日期', 10, required); if (s && (!/^\d{4}-\d{2}-\d{2}$/.test(s) || s.startsWith('0000') || !Number.isFinite(Date.parse(s)) || new Date(s).toISOString().slice(0,10) !== s)) throw new BadRequestException('日期不存在或格式无效'); return s; };
const number = (value: unknown, label: string, min: number, max: number) => { if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) throw new BadRequestException(`${label}超出有效范围`); return value; };
export function validateOrderWrite(raw: unknown): OrderWrite {
 const input = objectOf(raw), action = input.action;
 if (!['create','update','delete'].includes(action)) throw new BadRequestException('订单操作无效');
 const requestId = text(input.requestId, '请求标识', 80, true);
 if (!/^[A-Za-z0-9_-]{8,80}$/.test(requestId)) throw new BadRequestException('请求标识无效');
 const deleting = action === 'delete';
 if (!deleting && (!Array.isArray(input.lines) || !input.lines.length || input.lines.length > 200)) throw new BadRequestException('采购订单须包含1至200行物料');
 const lines: ErpOrderLine[] = deleting ? [] : input.lines.map((raw: unknown) => { const line = objectOf(raw); return {
  id:text(line.id,'明细ID'), ts:text(line.ts,'明细版本'), inventoryCode:text(line.inventoryCode,'存货编码',100,true), unitName:text(line.unitName,'单位',100,action==='create'), unitCode:text(line.unitCode,'单位编码',100),
  quantity:number(line.quantity,'数量',0.001,999999999), unitPrice:number(line.unitPrice ?? 0,'未税单价',0,99999999), taxRate:number(line.taxRate ?? 0,'税率',0,100), etaDate:day(line.etaDate),
 }; });
 const ids = lines.map(line=>line.id).filter(Boolean); if (new Set(ids).size !== ids.length) throw new BadRequestException('同一订单明细不能重复提交');
 return {requestId,action,orderNo:text(input.orderNo,'单据编号',100,action!=='create'),expectedId:text(input.expectedId,'订单身份',100,action!=='create'),expectedTs:text(input.expectedTs,'订单版本',100,action!=='create'),
  orderDate:deleting?'':day(input.orderDate,true),supplierCode:text(input.supplierCode,'供应商编码',100,!deleting),contractNo:text(input.contractNo,'合同号',100),memo:text(input.memo,'备注',1000),lines};
}
export function erpOrderView(raw: Row) {
 const details = Array.isArray(raw.PurchaseOrderDetails) ? raw.PurchaseOrderDetails : [];
 const state = objectOf(raw.VoucherState);
 const lines: ErpOrderLine[] = details.map((r:Row) => ({id:String(r.ID??''),ts:String(r.Ts??''),lineNo:String(r.RowNo??''),inventoryCode:String(r.Inventory?.Code??''),name:String(r.Inventory?.Name??''),spec:String(r.Inventory?.Specification??''),unitCode:String(r.Unit?.Code??''),unitName:String(r.Unit?.Name??''),quantity:Number(r.Quantity),receivedQty:Number(r.CountQuantity??0),unitPrice:Number(r.OrigDiscountPrice??r.OrigPrice??0),taxRate:Number(r.TaxRate??0)*100,etaDate:String(r.AcceptDate??'').slice(0,10)}));
 const editable = state.Code === '00' && lines.length > 0 && lines.every(line=>Number.isFinite(line.receivedQty) && line.receivedQty === 0) && !raw.ClosedBy && !raw.ClosedTime && details.every((line:Row)=>!['true','1'].includes(String(line.IsClose??'').toLowerCase()));
 return {id:String(raw.ID??''),orderNo:String(raw.Code??''),ts:String(raw.Ts??''),externalCode:String(raw.ExternalCode??''),orderDate:String(raw.VoucherDate??'').slice(0,10),supplierCode:String(raw.Partner?.Code??''),supplierName:String(raw.Partner?.Name??''),contractNo:String(raw.ContractId??''),memo:String(raw.Memo??''),approvalStatus:String(state.Name??''),editable,restriction:editable?'':'只允许维护ERP未审且未到货、未关闭的采购订单',lines};
}
export function createOrderPayload(input: OrderWrite, externalCode: string) {
 return {purchaseOrderDTO:{ExternalCode:externalCode,VoucherDate:input.orderDate,BusinessType:{Code:'01'},Partner:{Code:input.supplierCode},ContractId:input.contractNo,Memo:input.memo,
  VoucherDetails:input.lines.map(line=>({Inventory:{Code:line.inventoryCode},Unit:line.unitCode?{Code:line.unitCode}:{Name:line.unitName},Quantity:line.quantity,OrigDiscountPrice:line.unitPrice,TaxRate:line.taxRate/100,...(line.etaDate?{AcceptDate:line.etaDate}:{})}))}};
}
export function updateOrderPayload(input: OrderWrite, raw: Row) {
 const before = erpOrderView(raw);
 if (before.supplierCode !== input.supplierCode) throw new BadRequestException('公开接口未支持修改供应商');
 if (before.contractNo !== input.contractNo) throw new BadRequestException('公开接口未支持修改合同号');
 const details: Row[] = [];
 for (const line of input.lines) {
  const previous = line.id ? before.lines.find(row=>row.id===line.id) : undefined;
  if (line.id && !previous) throw new ConflictException('ERP明细身份发生变化，请重新读取');
  if (previous) {
   if (line.ts !== previous.ts || !line.ts) throw new ConflictException('ERP明细版本发生变化，请重新读取');
   if (line.unitName!==previous.unitName || line.unitCode!==previous.unitCode || line.unitPrice!==previous.unitPrice || Math.abs(line.taxRate-previous.taxRate)>0.000001 || line.etaDate!==previous.etaDate) throw new BadRequestException('公开接口未支持修改单位、价格、税率和预计到货日期');
   if (line.inventoryCode!==previous.inventoryCode || line.quantity!==previous.quantity) details.push({ID:line.id,Ts:line.ts,Status:2,Inventory:{Code:line.inventoryCode},Quantity:line.quantity});
  } else {
   if (line.unitPrice || line.taxRate || line.etaDate) throw new BadRequestException('新增明细的价格、税率和交期须在ERP中核对');
   details.push({Status:1,Inventory:{Code:line.inventoryCode},Quantity:line.quantity});
  }
 }
 for (const previous of before.lines) if (!input.lines.some(line=>line.id===previous.id)) { if (!previous.id || !previous.ts) throw new ConflictException('ERP明细缺少版本，不能删除'); details.push({ID:previous.id,Ts:previous.ts,Status:3}); }
 return {dto:{Code:input.orderNo,Ts:input.expectedTs,VoucherDate:input.orderDate,Memo:input.memo,PurchaseOrderDetails:details}};
}
export function orderMatches(input: OrderWrite, raw: Row) {
 const current=erpOrderView(raw);
 if (current.orderDate!==input.orderDate || current.supplierCode!==input.supplierCode || current.contractNo!==input.contractNo || current.memo!==input.memo || current.lines.length!==input.lines.length) return false;
 const remaining=[...current.lines];
 for(const line of input.lines) {
  const index=remaining.findIndex(row=>(!line.id||row.id===line.id)&&row.inventoryCode===line.inventoryCode&&Math.abs(row.quantity-line.quantity)<0.000001&&(input.action!=='create'||row.unitName===line.unitName&&Math.abs(row.unitPrice-line.unitPrice)<0.0001&&Math.abs(row.taxRate-line.taxRate)<0.0001&&(!line.etaDate||row.etaDate===line.etaDate)));
  if(index<0)return false;remaining.splice(index,1);
 }
 return true;
}
