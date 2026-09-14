/** Frontend review contracts. These records are isolated demonstrations, never ERP stock. */
export type DispositionKind = 'correction' | 'inbound' | 'isolation' | 'return';
export type ReturnMethod = 'return' | 'replacement';

export interface DispositionReceipt {
  id: string; version: number; orderNo: string; lineNo: string; deliveryNo: string;
  materialCode: string; materialName: string; spec: string; unit: string; supplierName: string;
  orderedQty: number; originalReceivedQty: number; receivedQty: number; receivedDate: string;
  qualifiedQty: number; defectiveQty: number; pendingJudgmentQty: number;
  inboundQty: number; isolatedQty: number; returnPlannedQty: number;
}

export interface DispositionInput {
  kind: DispositionKind; quantity: number; date: string; reason: string;
  warehouse: string; location: string; documentNo: string; owner: string;
  returnMethod: ReturnMethod; expectedDate: string; note: string;
}

export interface DispositionRecord extends DispositionInput {
  id: string; receiptId: string; createdAt: string; createdByName: string;
  beforeQty: number; afterQty: number;
}

export interface DispositionLimits {
  correctionMin: number; correctionMax: number; inbound: number; isolation: number; return: number;
}

export interface DispositionPreviewState { receipts: DispositionReceipt[]; records: DispositionRecord[] }

export const dispositionLabels: Record<DispositionKind, string> = {
  correction: '收货纠错', inbound: '合格入库', isolation: '不良隔离', return: '退换补货',
};
