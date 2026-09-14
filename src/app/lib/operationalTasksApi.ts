import { authFetch, readErrorMessage } from './authSession';
export type OperationalKind = 'warehouse' | 'quality';
export interface OperationalAssignment {
  version: number; userId: string; name: string; note: string; dueDate: string | null; at: string; by: string;
  history: Array<{ version: number; userId: string; name: string; note: string; dueDate: string | null; at: string; by: string }>;
}
export interface OperationalTask {
  id: string; kind: OperationalKind; lineId: string; orderNo: string; lineNo: string; materialName: string; supplierName: string;
  unit: string; quantity: number | null; dueDate: string | null; completed: boolean; state: string; quantityBasis: string; sourceVersion: string;
  assignment: OperationalAssignment | null; deliveryNo: string | null;
}
export interface OperationalTaskPage { items: OperationalTask[]; people: Array<{ id: string; name: string }>; nextCursor: string | null; canViewAll: boolean; canAssign: boolean; scope: string }
export interface OperationalCandidate { id: string; name: string; department: string | null; kinds: OperationalKind[] }
async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await authFetch(`/api/procurement/operational-tasks${path}`, init);
  if (!response.ok) throw new Error(await readErrorMessage(response, '仓管和质量任务读取失败'));
  return response.json();
}
export function fetchOperationalTasks(query: { kind: OperationalKind; owner: string; status: string; before?: string; cursor?: string }, signal?: AbortSignal) {
  return request<OperationalTaskPage>(`?${new URLSearchParams(query)}`, { signal });
}
export function fetchOperationalCandidates(signal?: AbortSignal) { return request<OperationalCandidate[]>('/candidates', { signal }); }
export function assignOperationalTask(task: OperationalTask, input: { userId: string; note: string; dueDate: string | null; expectedVersion: number; requestId: string }) {
  return request<OperationalAssignment>(`/${task.kind}/${encodeURIComponent(task.id)}/assignment`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) });
}
