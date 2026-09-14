/** Contracts for an isolated frontend review. No production stock or approvals. */
export type QualitySource = 'incoming' | 'warehouse' | 'production' | 'after_sales';
export type QualityStatus = 'unassigned' | 'processing' | 'awaiting_verification' | 'awaiting_close' | 'closed';
export type QualityCause = 'process' | 'packaging' | 'standard' | 'revision' | 'other';
export type QualityMethod = 'repair' | 'replacement' | 'return' | 'sorting';
export type QualityActionKind = 'assign' | 'cause' | 'disposition' | 'submit_verification' | 'verify' | 'close' | 'feedback';

export interface QualityFeedback { source: QualitySource; reference: string; note: string }
export interface QualityIssue {
  id: string; version: number; code: string; status: QualityStatus;
  source: QualitySource; discoveredDate: string; materialCode: string; materialName: string;
  category: string; spec: string; unit: string; supplierName: string; batchNo: string;
  orderNo: string; receiptId: string; inspectedQty: number; defectiveQty: number;
  phenomenon: string; evidence: string; owner: string; verifier: string; dueDate: string;
  causeCategory: QualityCause | ''; causeDetail: string; responsibility: string; causeEvidence: string;
  dispositionMethod: QualityMethod | ''; handledQty: number; dispositionDetail: string; dispositionEvidence: string;
  verificationRound: number; verificationQty: number; verificationResult: 'pending' | 'passed' | 'failed';
  verificationNote: string; verificationEvidence: string; closeNote: string;
  linkedFeedback: QualityFeedback[];
}

export interface QualityCreateInput {
  source: QualitySource; discoveredDate: string; materialCode: string; materialName: string;
  category: string; spec: string; unit: string; supplierName: string; batchNo: string;
  orderNo: string; inspectedQty: number; defectiveQty: number; phenomenon: string; evidence: string;
}

export type QualityActionInput =
  | { kind: 'assign'; owner: string; verifier: string; dueDate: string; note: string }
  | { kind: 'cause'; category: QualityCause; detail: string; responsibility: string; evidence: string }
  | { kind: 'disposition'; method: QualityMethod; handledQty: number; detail: string; evidence: string }
  | { kind: 'submit_verification'; note: string }
  | { kind: 'verify'; quantity: number; result: 'passed' | 'failed'; note: string; evidence: string }
  | { kind: 'close'; note: string }
  | { kind: 'feedback'; source: QualitySource; reference: string; note: string };

export interface QualityRecord {
  id: string; issueId: string; kind: QualityActionKind | 'create'; createdAt: string;
  actor: string; summary: string; details: { label: string; value: string }[];
  beforeStatus: QualityStatus; afterStatus: QualityStatus;
}
export interface QualityPreviewState { issues: QualityIssue[]; records: QualityRecord[] }

export const qualitySourceLabels: Record<QualitySource, string> = { incoming: '来料', warehouse: '仓库', production: '生产反馈', after_sales: '售后' };
export const qualityStatusLabels: Record<QualityStatus, string> = { unassigned: '待分派', processing: '处理中', awaiting_verification: '待复检', awaiting_close: '待关闭', closed: '已关闭' };
export const qualityCauseLabels: Record<QualityCause, string> = { process: '工艺', packaging: '包装', standard: '检验标准', revision: '版本', other: '其他' };
export const qualityMethodLabels: Record<QualityMethod, string> = { repair: '返工 / 维修', replacement: '换货 / 补货', return: '退货', sorting: '筛选处理' };
export const qualityActionLabels: Record<QualityActionKind, string> = { assign: '分派经办', cause: '确认原因', disposition: '登记处置', submit_verification: '提交复检', verify: '登记复检', close: '确认关闭', feedback: '关联反馈' };
export const qualityDemoPeople = ['演示采购员', '演示质量员', '演示仓管员', '演示生产主管'];
