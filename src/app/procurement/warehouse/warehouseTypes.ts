export type StockBucket = 'qualified' | 'inspection' | 'defective' | 'frozen';
export type WarehouseTab = 'inventory' | 'issues' | 'returns' | 'counts';
export type WarehouseActionKind = 'issue' | 'sign' | 'return_create' | 'return_receive' | 'return_discrepancy' | 'return_resubmit' | 'count_create' | 'count_edit' | 'count_submit' | 'count_approve' | 'count_reject';

export interface StockLot {
  id: string; version: number; materialCode: string; materialName: string; category: string;
  spec: string; revision: string; unit: string; batchNo: string; warehouse: string; location: string;
  supplierName: string; qualified: number; reserved: number; inspection: number; defective: number;
  frozen: number; source: string; updatedAt: string;
}
export interface DispatchMaterial {
  id: string; dispatchNo: string; line: string; productionBatch: string; componentName: string;
  componentQty: number; bomVersion: string; qtyPer: number | null; materialCode: string;
  materialName: string; unit: string; requiredQty: number | null; issuedQty: number;
}
export interface MaterialIssue {
  id: string; code: string; dispatchId: string; lotId: string; quantity: number;
  signedQty: number; returnedQty: number; consumedQty: number;
  status: 'pending_signature' | 'discrepancy' | 'signed'; actualQty: number | null;
  issuer: string; receiver: string; issuedAt: string; signedAt: string; note: string;
}
export interface MaterialReturn {
  id: string; code: string; issueId: string; quantity: number; actualQty: number | null;
  result: 'qualified' | 'inspection' | 'defective'; status: 'pending' | 'discrepancy' | 'received';
  applicant: string; receiver: string; createdAt: string; receivedAt: string;
  reason: string; evidence: string; discrepancyNote: string;
}
export interface StockCount {
  id: string; code: string; lotId: string; lotVersion: number; bucket: StockBucket;
  bookQty: number; actualQty: number; reservedQty: number; reason: string; evidence: string;
  reporter: string; reviewer: string; reviewNote: string; createdAt: string; reviewedAt: string;
  status: 'draft' | 'pending_review' | 'rejected' | 'approved';
}
export interface StockMovement {
  id: string; createdAt: string; lotId: string; kind: 'opening' | 'issue' | 'sign' | 'return' | 'adjustment';
  documentNo: string; source: string; destination: string; quantity: number; unit: string;
  actor: string; note: string;
}
export interface WarehouseRecord {
  id: string; createdAt: string; entityId: string; documentNo: string;
  title: string; actor: string; note: string;
}
export interface WarehouseState {
  version: number; lots: StockLot[]; dispatches: DispatchMaterial[]; issues: MaterialIssue[];
  returns: MaterialReturn[]; counts: StockCount[]; movements: StockMovement[]; records: WarehouseRecord[];
}
export type WarehouseAction =
  | { kind: 'issue'; dispatchId: string; lotId: string; quantity: number; actor: string; note: string }
  | { kind: 'sign'; issueId: string; actualQty: number; actor: string; note: string }
  | { kind: 'return_create'; issueId: string; quantity: number; result: MaterialReturn['result']; actor: string; note: string; evidence: string }
  | { kind: 'return_receive'; returnId: string; actualQty: number; result: MaterialReturn['result']; reviewed: boolean; actor: string; note: string; evidence: string }
  | { kind: 'return_discrepancy'; returnId: string; actualQty: number; actor: string; note: string }
  | { kind: 'return_resubmit'; returnId: string; quantity: number; actor: string; note: string }
  | { kind: 'count_create'; lotId: string; bucket: StockBucket; actualQty: number; actor: string; note: string; evidence: string }
  | { kind: 'count_edit'; countId: string; actualQty: number; actor: string; note: string; evidence: string }
  | { kind: 'count_submit'; countId: string; actor: string; note: string }
  | { kind: 'count_approve'; countId: string; actor: string; note: string }
  | { kind: 'count_reject'; countId: string; actor: string; note: string };

export interface WarehouseActionContext {
  state: WarehouseState; kind: WarehouseActionKind;
  lotId?: string; dispatchId?: string; issueId?: string; returnId?: string; countId?: string;
}
export const stockBucketLabels: Record<StockBucket, string> = { qualified: '合格现存', inspection: '待检', defective: '不良隔离', frozen: '冻结' };
export const warehouseTabLabels: Record<WarehouseTab, string> = { inventory: '库存记录', issues: '发料与签收', returns: '生产退料', counts: '盘点复核' };
export const warehouseActionLabels: Record<WarehouseActionKind, string> = {
  issue: '登记发料', sign: '生产签收', return_create: '登记退料', return_receive: '核对接收',
  return_discrepancy: '退回核对', return_resubmit: '更正退料数量', count_create: '新建盘点',
  count_edit: '修改实盘', count_submit: '提交复核', count_approve: '复核通过并调整', count_reject: '退回修改',
};
export const warehousePeople = ['演示仓管员', '演示线长', '演示质量员', '演示复核人'];
