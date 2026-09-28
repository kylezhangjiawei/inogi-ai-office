import { authFetch, readErrorMessage } from './authSession';
import type { ExecutionTask } from './productionExecutionApi';
export interface LifecycleDocument { kind: 'sop' | 'sip' | 'drawing'; documentId: string; versionId: string; attachmentId: string; fileId?: string; name: string; version: string }
export interface LifecycleFeedback { id: string; problem: string; reporterId: string; reporterName: string; at: string; ownerId: string; ownerName: string; dueDate: string; status: 'open' | 'processing' | 'resolved'; history: { actorId: string; actorName: string; at: string; status: LifecycleFeedback['status']; ownerId: string; ownerName: string; dueDate: string; reason: string }[] }
export interface LifecycleVersionRange { id: string; batchId: string; quantity: number; range: string; softwareVersion: string; hardwareVersion: string; serialNumbers: string[]; actorId: string; actorName: string; at: string; evidence: string; supersedesId?: string }
export interface LifecycleShipmentSerial { number: string; versionRangeId: string; softwareVersion: string; hardwareVersion: string }
export interface LifecycleShipmentSerialHistory { action: 'bind' | 'reverse'; serials: LifecycleShipmentSerial[]; actorId: string; actorName: string; at: string; reason: string }
export interface Lifecycle {
  handlers?: { id: string; name: string }[];
  versionRanges?: LifecycleVersionRange[];
  warehouse: { id: string; taskId?: string; batchId: string; kind: string; status: string; title?: string; name?: string; quantity?: number; qualifiedQty?: number; defectiveQty?: number; pendingQty?: number; unit?: string }[];
  qualityRecords: { id: string; batchNo: string; status: string; issue: string; disposition: string; resolution: string | null }[];
  verificationHistory: { recordId: string; actorName: string; evidence: string; recordedAt: string; kind: string; passedQty: number | null; closed: boolean }[];
  version: number;
  transfers: { documents?: LifecycleDocument[]; id: string; code: string; type: 'exploration' | 'validation'; sampleTaskId: string; roundId: string; status: 'draft' | 'validated' | 'published'; authorId: string; validatorId?: string; sop: string; sip: string; drawing: string; evidence: string; validation?: string }[];
  changes: { previousPackageIds?: string[]; feedback?: LifecycleFeedback[]; id: string; code: string; packageId: string; batchIds: string[]; effectiveDate: string; handling: string; validation: string; status: 'draft' | 'published'; acknowledgments: { actorId: string; actorName: string; at: string }[] }[];
  releases: { id: string; batchId: string; quantity: number; source: string; actorName: string; at: string; evidence: string }[];
  shipments: { id: string; batchId: string; releaseId: string; quantity: number; date: string; order: string; voucher: string; recipient: string; evidence: string; actorName: string; serials?: LifecycleShipmentSerial[]; serialHistory?: LifecycleShipmentSerialHistory[]; linkedSerialQty?: number; pendingSerialQty?: number; reversed?: { actorName: string; at: string; reason: string } }[];
  batches: { id: string; code: string; quantity: number; dueDate: string; completedQty: number; openQuality: number; uninspected: boolean; releasedQty: number; releaseId: string | null; shippedQty: number; tasks: ExecutionTask[] }[];
  sampleTasks: { documents?: Omit<LifecycleDocument, 'kind'>[]; id: string; title: string; code: string; roundId: string; result: string | null }[];
  events: { id: string; action: string; actorName: string; at: string; reason: string; subjectId: string }[];
}
export interface Readiness {
  scopeId?: string; batchId?: string | null; batchCode?: string | null;
  sourceToken: string;
  planId: string; planVersion: number; bomFingerprint: string; month: string; targetQty: number; completedQty: number; remainingQty: number; date: string; currentSets: number | null; projectedSets: number | null;
  lines: { stockReadAt?: string; stockRows?: { warehouse: string; available: number | null; syncedAt: string | null; unit: string }[]; id: string; code: string; name: string; unit: string; qtyPer: number; demand: number; remainingDemand: number; warehouse: number | null; warehousePending: number; otherReserved: number; ownReserved: number; lineQty: number; incoming: number; current: number | null; projected: number | null; gap: number | null; problems: string[]; lineSide: { taskId: string; name: string; quantity: number; confirmedQty: number; confirmed: boolean }[]; purchase: ReadinessPurchase[] }[];
  history: { id: string; at: string; date: string; currentSets: number | null; projectedSets: number | null; actorName: string; planVersion: number }[];
}
export interface ReadinessPurchase {
  erpDate?: string | null; promisedDate?: string | null; timingNote?: string;
  id: string; orderNo: string; supplier: string; date: string | null; quantity: number | null; included: boolean; note: string;
  // Older immutable snapshots predate explicit purchase allocation.
  allocationStatus?: 'implicit' | 'unallocated' | 'confirmed' | 'stale' | 'released';
  assignedQty?: number; allocatedQty?: number; otherAllocatedQty?: number; maxAllocatable?: number; canAllocate?: boolean;
  coveredAllocationQty?: number; batchAllocatedQty?: number;
  allocationHistory?: { quantity: number; actorName: string; at: string; reason: string }[];
}
async function request<T>(id: string, path: string, init?: RequestInit) { const response = await authFetch(`/api/procurement/production-execution/${encodeURIComponent(id)}/${path}`, init); if (!response.ok) throw new Error(await readErrorMessage(response, '生产业务请求失败')); return response.json() as Promise<T>; }
export const getLifecycleDocument = (id: string, versionId: string, signal?: AbortSignal) => request<{ id: string; name: string; mime: string; url: string; previewUrl: string; downloadUrl: string }>(id, `lifecycle/documents/${encodeURIComponent(versionId)}`, { signal });
export const getLifecycle = (id: string, signal?: AbortSignal) => request<Lifecycle>(id, 'lifecycle', { signal });
export const getProductionReadiness = (id: string, date: string, signal?: AbortSignal, snapshotId?: string, batchId?: string) => request<Readiness>(id, `readiness?${new URLSearchParams({ date, ...(snapshotId ? { snapshotId } : {}), ...(batchId ? { batchId } : {}) })}`, { signal });
export const commandProductionLifecycle = (id: string, path: 'lifecycle' | 'readiness', input: { action: string; requestId: string; version: number; data: Record<string, unknown> }) => request<{ saved: true }>(id, path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) });
