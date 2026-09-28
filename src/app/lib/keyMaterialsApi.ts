import { authFetch, readErrorMessage } from './authSession';
export interface KeyMaterialMapping { version: number; materialIds: string[]; inclusion: 'included' | 'pending' | 'excluded'; actorId: string; actorName: string; note: string; at: string | null }
export interface KeyMaterialClue { id: string; name: string; group: string; check: string; sourceTime: string; kind: 'key' | 'range' | 'candidate'; mapping: KeyMaterialMapping }
export interface KeyMaterial { id: string; name: string; spec: string; unit: string; category: string; productLine: string; tpInventoryCode: string | null; erpCode: string; available?: number | null; inTransit?: number | null; syncedAt?: string | null; scope?: KeyMaterialMapping }
export interface KeyMaterialDirectory { clues: KeyMaterialClue[]; materials: KeyMaterial[]; canReview: boolean }
export interface KeyMaterialMonthly { month: string; date: string; planCount: number; clues: KeyMaterialClue[]; materials: (KeyMaterial & { plans: { planId: string; productId?: string; productName?: string; productLine: string; demand: number; remainingDemand: number | null; gap: number | null; date: string; problems: string[]; incoming: number; purchase: { id: string; orderNo: string; supplier: string; date: string | null; included: boolean }[] }[]; quality: { id: string; issue: string; status: string }[]; tasks: { id: string; code: string; buyer: string; status: string }[] })[] }
async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await authFetch(`/api/procurement/key-materials${path}`, init);
  if (!response.ok) throw new Error(await readErrorMessage(response, '关键物料请求失败'));
  return response.json();
}
export const getKeyMaterialDirectory = (signal?: AbortSignal) => request<KeyMaterialDirectory>('', { signal });
export const getKeyMaterialMonthly = (month: string, date: string, signal?: AbortSignal) => request<KeyMaterialMonthly>(`/monthly?${new URLSearchParams({ month, date })}`, { signal });
export const searchKeyMaterials = (q: string, page: number, signal?: AbortSignal) => request<{ items: KeyMaterial[]; total: number; page: number; pageSize: number }>(`/options?${new URLSearchParams({ q, page: String(page) })}`, { signal });
export const getKeyMaterialHistory = (id: string, signal?: AbortSignal) => request<KeyMaterialMapping[]>(`/${encodeURIComponent(id)}/history`, { signal });
export const saveKeyMaterialMapping = (id: string, input: { requestId: string; version: number; materialIds: string[]; inclusion: KeyMaterialMapping['inclusion']; note: string }) => request<{ saved: boolean }>(`/${encodeURIComponent(id)}/mapping`, { method: 'POST', body: JSON.stringify(input) });
