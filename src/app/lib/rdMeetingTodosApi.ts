import { authFetch, readErrorMessage } from './authSession';

export const MEETING_ADMIN_PERMISSIONS = ['rd-task:reassign', 'rd-project:direct', 'rd-project:review-l1', 'rd-project:review-l2', 'rd-people:manage'];
export type MeetingMember = { id: string; name: string; department: string; position: string };
export type MeetingTodo = {
  id: string; memberId: string; memberName: string; title: string; description: string;
  dueDate: string | null; status: 'todo' | 'done';
  createdAt: string; createdBy: { id: string; name: string };
  updatedAt: string; updatedBy: { id: string; name: string };
  deletedAt?: string; deletedBy?: { id: string; name: string };
  carriedFrom?: { weekStart: string; itemId: string };
};
export type MeetingWeek = {
  weekStart: string; revision: number; createdAt: string; createdBy: { id: string; name: string };
  updatedAt: string; items: MeetingTodo[];
};
export type MeetingHistory = { weeks: { weekStart: string; total: number; completed: number; updatedAt: string }[]; nextBefore: string | null };
export type MeetingDraft = Pick<MeetingTodo, 'memberId' | 'title' | 'description' | 'dueDate'>;

export class MeetingRequestError extends Error {
  constructor(message: string, public status: number) { super(message); }
}
async function request<T>(path: string, method = 'GET', body?: unknown, signal?: AbortSignal): Promise<T> {
  const response = await authFetch(`/api/research-development/meeting-todos${path}`, {
    method, ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal,
  });
  if (!response.ok) throw new MeetingRequestError(await readErrorMessage(response, '会议待办请求失败'), response.status);
  return response.json();
}
export const meetingTodosApi = {
  members: (signal?: AbortSignal) => request<MeetingMember[]>('/members', 'GET', undefined, signal),
  week: async (week: string, signal?: AbortSignal) => (await request<{ week: MeetingWeek | null }>(`/weeks/${week}`, 'GET', undefined, signal)).week,
  history: (before?: string) => request<MeetingHistory>(`/weeks${before ? `?before=${before}` : ''}`),
  createWeek: (weekStart: string, copyFromWeek?: string) => request<MeetingWeek>('/weeks', 'POST', { weekStart, copyFromWeek }),
  add: (week: MeetingWeek, draft: MeetingDraft) => request<MeetingWeek>(`/weeks/${week.weekStart}/items`, 'POST', { ...draft, revision: week.revision }),
  update: (week: MeetingWeek, id: string, changes: Partial<MeetingDraft> & { status?: MeetingTodo['status'] }) => request<MeetingWeek>(`/weeks/${week.weekStart}/items/${id}`, 'PATCH', { ...changes, revision: week.revision }),
  remove: (week: MeetingWeek, id: string) => request<MeetingWeek>(`/weeks/${week.weekStart}/items/${id}`, 'DELETE', { revision: week.revision }),
};

// Date-only arithmetic stays in UTC so weeks also work across DST and year boundaries.
export function shiftMeetingDate(date: string, days: number): string {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}
export function meetingWeekStart(date: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const value = new Date(`${date}T00:00:00Z`);
  if (!Number.isFinite(value.getTime()) || value.toISOString().slice(0, 10) !== date) return null;
  return shiftMeetingDate(date, -((value.getUTCDay() + 6) % 7));
}
export const meetingWeekLabel = (week: string) => `${week.replaceAll('-', '.')} — ${shiftMeetingDate(week, 6).slice(5).replace('-', '.')}`;
