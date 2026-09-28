import { authFetch, readErrorMessage } from './authSession';
export interface WarehouseRecord {
  id: string; version: number; kind: 'receipt' | 'return' | 'count' | 'freeze' | 'scrap'; status: 'pending' | 'confirmed' | 'cancelled';
  review?: { open: boolean; actualQty: number; reason: string; actorName: string; at: string }; receivingLocation?: string;
  countStage?: 'counting' | 'review'; countedBy?: string; countedByName?: string; countedAt?: string; inventoryVersion?: string;
  stockBatchNo?: string; releasedAt?: string; qualityId?: string;
  code: string; name: string; unit: string; warehouse: string; batch: string; date: string; quantity: number; qualifiedQty: number; defectiveQty: number; pendingQty: number;
  actorId: string; actorName: string; sourceId: string; taskId?: string; planId?: string; countedQty?: number; bookQty?: number; origin?: string;
  events: { action: string; actorName: string; at: string; reason: string }[]; reconciliation?: { voucher: string; line: string; actorName: string; at: string; evidence: string };
}
export interface WarehouseRecords {
  records: WarehouseRecord[];
  receipts: { id: string; version: number; code: string; name: string; unit: string; deliveryNo: string; orderNo: string; qualifiedQty: number; defectiveQty: number }[];
  balances: { tpInventoryCode: string; warehouse: string; unit: string; stockQty: string; availableQty: string; syncedAt: string | null; material: { name: string } | null }[];
}
async function request<T>(init?: RequestInit) { const response = await authFetch('/api/procurement/warehouse-records', init); if (!response.ok) throw new Error(await readErrorMessage(response, '仓库台账请求失败')); return response.json() as Promise<T>; }
export const getWarehouseRecords = (signal?: AbortSignal) => request<WarehouseRecords>({ signal });
export const commandWarehouseRecord = (input: { requestId: string; action: string; id?: string; version?: number; data: Record<string, unknown> }) => request<{ id: string }>({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) });
