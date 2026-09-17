import { authFetch, readErrorMessage } from './authSession';
import type { QualityRecord } from './procurementOperationsApi';
export interface ExecutionBomLine { id: string; code: string; name: string; unit: string; qtyPer: number }
export interface ExecutionReport { id: string; date: string; quantity: number; goodQty: number; note: string; actorId: string; actorName: string; at: string }
export interface ExecutionInspection { id: string; reportId: string; date: string; quantity: number; goodQty: number; evidence: string; actorName: string; qualityId: string | null; verifiedGoodQty: number; quality: QualityRecord | null }
export interface ExecutionTask { id: string; batchId: string; name: string; treeNodeId: string; output: 'whole' | 'component'; unit: string; quantity: number; date: string; line: string; ownerId: string; ownerName: string; materials: Array<ExecutionBomLine & { requiredQty: number }>; status: 'draft' | 'dispatched' | 'cancelled'; reports: ExecutionReport[]; inspections: ExecutionInspection[] }
export interface ExecutionPlan { carryover: boolean; scope: 'all' | 'assigned'; id: string; version: number; month: string; productId: string; productName: string; productLine: string; targetQty: number; shipmentTargetQty: number; bom: ExecutionBomLine[]; bomFingerprint: string; batches: { id: string; code: string; quantity: number; dueDate: string }[]; tasks: ExecutionTask[]; events: { id: string; action: string; reason: string; actorName: string; at: string; subjectId: string }[]; summary: { batchQty: number; reportedWholeQty: number; reportedWholeGoodQty: number; remainingReportedQty: number; completedQty: number; remainingQty: number; tasks: number } }
export interface ExecutionOptions { nodes: { id: string; productId: string; parentId: string | null; name: string }[]; models: string[]; users: { id: string; name: string; canReport: boolean; canCollaborate: boolean }[] }
async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await authFetch(`/api/procurement/production-execution${path}`, init);
  if (!response.ok) throw new Error(await readErrorMessage(response, '生产计划请求失败'));
  return response.json();
}
export const listExecutionPlans = (month: string, signal?: AbortSignal) => request<ExecutionPlan[]>(`?${new URLSearchParams({ month })}`, { signal });
export const getExecutionOptions = (signal?: AbortSignal) => request<ExecutionOptions>('/options', { signal });
export const createExecutionPlan = (input: Record<string, unknown>) => request<{ id: string }>('', { method: 'POST', body: JSON.stringify(input) });
export const commandExecutionPlan = (id: string, input: { requestId: string; version: number; action: string; data: Record<string, unknown> }) => request<{ id: string }>(`/${encodeURIComponent(id)}/commands`, { method: 'POST', body: JSON.stringify(input) });
