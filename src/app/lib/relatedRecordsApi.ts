import { authFetch, readErrorMessage } from './authSession';
export interface OriginalRecordItem { id: string; kind: string; title: string; code: string; state: string; owner: string; dueDate: string | null; detail: string; href: string }
export interface PersonalOriginalRecords { items: OriginalRecordItem[]; errors: string[]; readAt: string; scope: string }
async function get<T>(path: string, signal?: AbortSignal): Promise<T> { const response = await authFetch('/api/procurement/related-records' + path, { signal }); if (!response.ok) throw new Error(await readErrorMessage(response, '原记录读取失败')); return response.json(); }
export const getMyOriginalRecords = (signal?: AbortSignal) => get<PersonalOriginalRecords>('/mine', signal);
export const getRdOriginalRecords = (rdTaskId: string, signal?: AbortSignal) => get<{ items: OriginalRecordItem[] }>('/rd/' + encodeURIComponent(rdTaskId), signal);
