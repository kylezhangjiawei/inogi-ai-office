import { authFetch, readErrorMessage } from './authSession';
export interface ProcurementDecision {
  taskId: string; unit: string; code: string | null;
  candidates: Array<{ id: string; month: string; productName: string; batches: Array<{ id: string; code: string; dueDate: string }> }>;
  planId: string | null; batchId: string | null; date: string | null;
  shortage: number | null; covered: number | null; suggested: number | null; unaccepted: number | null;
  problems: string[]; orderProblems: string[];
  basis: { planVersion: number; remainingDemand: number; current: number; incoming: number; warehouse: number; warehousePending: number; otherReserved: number; lineQty: number; excludedOrders: number; orders: Array<{ orderNo: string; lineNo: string; ordered: number | null; qualified: number | null; unaccepted: number | null }> } | null;
}
export async function getProcurementDecision(taskId: string, query: { planId?: string; batchId?: string; date?: string }, signal?: AbortSignal): Promise<ProcurementDecision> {
  const params = new URLSearchParams(); Object.entries(query).forEach(([key, value]) => { if (value) params.set(key, value); });
  const response = await authFetch(`/api/procurement/tasks/${encodeURIComponent(taskId)}/decision?${params}`, { signal });
  if (!response.ok) throw new Error(await readErrorMessage(response, '采购决策读取失败'));
  return response.json();
}
