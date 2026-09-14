export type ShipmentStatus = 'draft' | 'confirmed' | 'reversed';
export type ShipmentActionKind = 'create' | 'edit' | 'confirm' | 'reverse' | 'sn';
export interface ShipmentBatch {
  id: string; batchNo: string; productCode: string; productName: string; planNo: string;
  completedQty: number; inspectionPassedQty: number; inspectionEvidence: string;
  releasedQty: number; releaseEvidence: string; releasedOn: string;
  softwareVersion: string; hardwareVersion: string; bomVersion: string; versionQuantity: number;
  source: string;
}
export interface ShipmentRecord {
  id: string; documentNo: string; actualDate: string; customer: string; orderNo: string;
  batchId: string; quantity: number; handler: string; note: string; serialNumbers: string[];
  status: ShipmentStatus; createdAt: string; confirmedAt: string | null; reversedAt: string | null;
  replacementFor: string | null;
}
export interface ShipmentHistory {
  id: string; recordId: string; kind: ShipmentActionKind; actor: string; at: string; reason: string;
  before: ShipmentRecord | null; after: ShipmentRecord;
}
export interface ShipmentState {
  version: number; batches: ShipmentBatch[]; records: ShipmentRecord[]; history: ShipmentHistory[];
  months: Record<string, { target: number; completed: number }>;
}
export interface ShipmentDraftInput {
  documentNo: string; actualDate: string; customer: string; orderNo: string; batchId: string;
  quantity: number; handler: string; note: string; serialNumbers: string[];
}
export type ShipmentAction =
  | ({ kind: 'create'; actor: string } & ShipmentDraftInput)
  | ({ kind: 'edit'; recordId: string; actor: string; reason: string } & ShipmentDraftInput)
  | { kind: 'confirm'; recordId: string; actor: string }
  | { kind: 'reverse'; recordId: string; actor: string; reason: string; createReplacement: boolean }
  | { kind: 'sn'; recordId: string; actor: string; reason: string; serialNumbers: string[] };
export interface ShipmentActionContext {
  kind: ShipmentActionKind; state: ShipmentState; recordId?: string; readOnly?: boolean;
}
export const shipmentStatusLabels: Record<ShipmentStatus, string> = { draft: '待确认', confirmed: '已出库', reversed: '已冲销' };
export const shipmentActionLabels: Record<ShipmentActionKind, string> = { create: '登记出货', edit: '修改登记', confirm: '确认实际出库', reverse: '冲销 / 更正', sn: '补充 SN' };
