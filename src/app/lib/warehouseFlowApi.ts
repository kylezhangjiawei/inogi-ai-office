import { authFetch, readErrorMessage } from './authSession';
export interface WarehouseReconciliation {
  eventId: string; method: 'manual'; result: 'matched' | 'difference' | 'revoked';
  voucherNumber?: string; posted?: boolean; detailsMatch?: boolean;
  lines: { code: string; voucherLine: string; quantity: number; voucherQuantity: number }[];
}
export interface WarehouseReconcileInput {
  requestId: string; version: number; eventId: string; reason: string; revoke?: boolean;
  voucherNumber?: string; posted?: boolean; detailsMatch?: boolean; lines?: WarehouseReconciliation['lines'];
}
export interface WarehouseIssue {
  id: string; version: number; status: 'requested' | 'partial' | 'issued' | 'signed' | 'cancelled'; planId: string; taskId: string; productLine: string; title: string; neededDate: string; recipientId: string; recipientName: string;
  lines: { code: string; name: string; unit: string; quantity: number; issuedQty?: number; signedQty?: number }[];
  history: { id: string; action: string; actorName: string; at: string; reason: string; erpPosting?: 'pending'; lines?: { code: string; quantity: number; warehouse?: string }[]; reconciliation?: WarehouseReconciliation }[];
}
export interface WarehouseFlowResponse { items: WarehouseIssue[]; canIssue: boolean; canReconcile: boolean; balances: { code: string; warehouse: string; unit: string; available: number; syncedAt: string | null }[] }
async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await authFetch(`/api/procurement/warehouse-flow${path}`, init);
  if (!response.ok) throw new Error(await readErrorMessage(response, '领料业务请求失败'));
  return response.json();
}
export const getWarehouseFlows = (taskId: string, status: string, signal?: AbortSignal) => request<WarehouseFlowResponse>(`?${new URLSearchParams({ ...(taskId ? { taskId } : {}), status })}`, { signal });
export const commandWarehouseFlow = (id: string, input: { requestId: string; version: number; action: 'issue' | 'sign'; reason: string; lines: { code: string; quantity: number; warehouse?: string }[] }) => request<{ id: string }>(`/${encodeURIComponent(id)}/commands`, { method: 'POST', body: JSON.stringify(input) });
export const reconcileWarehouseFlow = (id: string, input: WarehouseReconcileInput) => request<{ id: string }>(`/${encodeURIComponent(id)}/reconciliations`, { method: 'POST', body: JSON.stringify(input) });
