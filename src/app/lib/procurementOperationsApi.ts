import { authFetch, readErrorMessage } from './authSession';

export type QualityAnalysis = {
  materialBatches?: { code: string; batchNo: string | null }[];
  version: number; state: 'pending' | 'confirmed'; category: 'unknown' | 'process' | 'packaging' | 'standard' | 'revision' | 'material' | 'other';
  detail: string; evidence: string; responsibility: { kind: 'unknown' | 'internal' | 'supplier' | 'other'; id?: string; name: string };
  phenomena: { name: string; count: number }[]; files: { fileId: string; name: string; mime: string; size: number }[];
  references: { source: QualitySource; reference: string; note: string }[];
  confirmedBy?: string; confirmedByName?: string; confirmedAt?: string;
  history: { actorId: string; actorName: string; at: string; action: string; reason: string; snapshot: Omit<QualityAnalysis, 'history'> }[];
};
export interface QualityAnalysisResponse { record: QualityRecord; analysis: QualityAnalysis; people: { id: string; name: string }[]; suppliers: { id: string; name: string }[]; productionSource: { planVersion?: number; planId: string; taskId: string; fieldIssueId?: string; reportId?: string; inspectionId?: string } | null; receivedBatches: { code: string; name: string; batches: { batchNo: string; quantity: number }[] }[] }
export const getQualityAnalysis = (id: string, signal?: AbortSignal) => request<QualityAnalysisResponse>(`/quality-records/${encodeURIComponent(id)}/analysis`, { signal });
export const saveQualityAnalysis = (id: string, input: { requestId: string; version: number; baseUpdatedAt: string; action: 'save' | 'confirm'; data: Record<string, unknown> }) => request<{ id: string }>(`/quality-records/${encodeURIComponent(id)}/analysis`, { method: 'POST', body: JSON.stringify(input) });
export const getQualityAttachment = (id: string, fileId: string, signal?: AbortSignal) => request<{ id: string; name: string; mime: string; size: number; url: string; previewUrl: string; downloadUrl: string }>(`/quality-records/${encodeURIComponent(id)}/attachments/${encodeURIComponent(fileId)}`, { signal });


export type OperationsScope = { productId: string; treeNodeId?: string; stockPlanId?: string; month?: string; qualityView?: 'month' | 'pending' };
export type QualitySource = 'procurement' | 'production' | 'warehouse' | 'after_sales';
export type QualityStatus = 'open' | 'processing' | 'closed';
export type QualityDisposition = 'pending' | 'return' | 'rework' | 'scrap' | 'concession' | 'replacement';

export interface ProductionReportInput {
  requestId?: string;
  productId: string; treeNodeId: string; stockPlanId?: string | null;
  reportDate: string; shift: string; lineName: string; unit: string;
  plannedQty: number; actualQty: number; goodQty: number; workHours: number;
  capacityQty?: number | null; note?: string | null; baseUpdatedAt?: string;
}
export interface QualityRecordInput {
  productId: string; treeNodeId: string; stockPlanId?: string | null;
  productionReportId?: string | null; taskId?: string | null; materialId?: string | null; supplierId?: string | null;
  source: QualitySource; batchNo: string; inspectionDate: string; unit: string;
  inspectedQty: number; defectiveQty: number; issue: string;
  disposition: QualityDisposition; status: QualityStatus; resolution?: string | null; baseUpdatedAt?: string;
}
interface RecordIdentity { id: string; treeNodeName: string; stockPlanCode: string | null; createdByName: string; updatedByName?: string | null; createdAt: string; updatedAt: string }
export interface ProductionReport extends ProductionReportInput, RecordIdentity { defectiveQty: number; capacityQty: number | null }
export interface ProductionFollowUp extends ProductionReport { unregisteredDefectiveQty: number; unregisteredInspectedQty: number }
export interface QualityRecord extends QualityRecordInput, RecordIdentity { analysis?: QualityAnalysis | null; taskCode: string | null; materialName: string | null; supplierName: string | null; resolvedAt: string | null; defectRate: number | null; collaboration?: { department?: string | null; priority?: 'high' | 'medium' | 'low'; dueDate?: string; requiredInfo?: string; verificationPlan?: string; ownerId: string; ownerName: string; originatorName: string; phase: 'waiting_reply' | 'returned'; reason: string; reply: string | null; repliedByName?: string } | null }
export interface ProductionSummary {
  unit: string; reports: number; plannedQty: number; actualQty: number; goodQty: number; defectiveQty: number;
  workHours: number; capacityQty: number | null; capacityRecorded: number; attainmentRate: number | null; yieldRate: number | null; capacityUtilization: number | null;
}
export interface QualitySummary { source: QualitySource; unit: string; records: number; open: number; inspectedQty: number; defectiveQty: number; defectRate: number | null }
export interface OperationsResponse { month: string; productionReports: ProductionReport[]; productionFollowUps?: ProductionFollowUp[]; qualityRecords: QualityRecord[]; productionSummary: ProductionSummary[]; qualitySummary: QualitySummary[] }
export interface OperationsOptions {
  plans: Array<{ id: string; code: string; unit: string; materialId: string | null }>;
  tasks: Array<{ id: string; code: string; materialId: string | null; stockPlanId: string | null; unit: string }>;
  materials: Array<{ id: string; name: string; unit: string }>;
  suppliers: Array<{ id: string; name: string }>;
  productionReports: Array<{ id: string; reportDate: string; shift: string; lineName: string; unit: string; stockPlanId: string | null; actualQty: number; defectiveQty: number }>;
}

function query(scope: OperationsScope) {
  const search = new URLSearchParams({ productId: scope.productId });
  if (scope.treeNodeId) search.set('treeNodeId', scope.treeNodeId);
  if (scope.stockPlanId) search.set('stockPlanId', scope.stockPlanId);
  if (scope.month) search.set('month', scope.month);
  if (scope.qualityView) search.set('qualityView', scope.qualityView);
  return search.toString();
}
async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await authFetch(`/api/procurement/operations${path}`, init);
  if (!response.ok) throw new Error(await readErrorMessage(response, '生产与质量数据请求失败'));
  return response.json() as Promise<T>;
}
export function getProcurementOperations(scope: OperationsScope, signal?: AbortSignal) { return request<OperationsResponse>(`?${query(scope)}`, { signal }); }
export function getProcurementOperationsOptions(scope: OperationsScope, signal?: AbortSignal) { return request<OperationsOptions>(`/options?${query(scope)}`, { signal }); }
export function getProductionStockPlanSource(taskId: string) { return request<{ taskId: string; productId: string; title: string }>(`/production-task-source/${encodeURIComponent(taskId)}`); }
export function saveProductionReport(id: string | null, input: ProductionReportInput) {
  return request<ProductionReport>(`/production-reports${id ? `/${encodeURIComponent(id)}` : ''}`, { method: id ? 'PUT' : 'POST', body: JSON.stringify(input) });
}
export function saveQualityRecord(id: string | null, input: QualityRecordInput) {
  return request<QualityRecord>(`/quality-records${id ? `/${encodeURIComponent(id)}` : ''}`, { method: id ? 'PUT' : 'POST', body: JSON.stringify(input) });
}

export interface QualityVerification {
  scope?: 'remaining' | 'all'; effectivePassedQty?: number;
  kind: 'verification' | 'reopen'; requestId: string; recordId: string;
  actorId: string; actorName: string; recordedAt: string; sourceVersion: string;
  verificationDate: string | null; inspectedQty: number | null; passedQty: number | null;
  evidence: string; closed: boolean;
  source: { batchNo: string; unit: string; defectiveQty: string; disposition: string; resolution: string | null };
}
export interface QualityVerificationInput {
  scope?: 'remaining' | 'all';
  requestId: string; baseUpdatedAt: string; verificationDate: string;
  inspectedQty: number; passedQty: number; evidence: string;
}
export function getQualityVerifications(id: string, signal?: AbortSignal) {
  return request<QualityVerification[]>(`/quality-records/${encodeURIComponent(id)}/verifications`, { signal });
}
export function verifyQualityRecord(id: string, input: QualityVerificationInput) {
  return request<{ status: QualityStatus; updatedAt: string; closed: boolean }>(`/quality-records/${encodeURIComponent(id)}/verifications`, { method: 'POST', body: JSON.stringify(input) });
}
export function reopenQualityRecord(id: string, input: { requestId: string; baseUpdatedAt: string; reason: string }) {
  return request<{ status: QualityStatus; updatedAt: string; closed: boolean }>(`/quality-records/${encodeURIComponent(id)}/reopen`, { method: 'POST', body: JSON.stringify(input) });
}
