import { authFetch, readErrorMessage } from './authSession';

export type OperationsScope = { productId: string; treeNodeId?: string; stockPlanId?: string; month?: string };
export type QualitySource = 'procurement' | 'production';
export type QualityStatus = 'open' | 'processing' | 'closed';
export type QualityDisposition = 'pending' | 'return' | 'rework' | 'scrap' | 'concession' | 'replacement';

export interface ProductionReportInput {
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
export interface QualityRecord extends QualityRecordInput, RecordIdentity { taskCode: string | null; materialName: string | null; supplierName: string | null; resolvedAt: string | null; defectRate: number | null }
export interface ProductionSummary {
  unit: string; reports: number; plannedQty: number; actualQty: number; goodQty: number; defectiveQty: number;
  workHours: number; capacityQty: number | null; capacityRecorded: number; attainmentRate: number | null; yieldRate: number | null; capacityUtilization: number | null;
}
export interface QualitySummary { source: QualitySource; unit: string; records: number; open: number; inspectedQty: number; defectiveQty: number; defectRate: number | null }
export interface OperationsResponse { month: string; productionReports: ProductionReport[]; qualityRecords: QualityRecord[]; productionSummary: ProductionSummary[]; qualitySummary: QualitySummary[] }
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
