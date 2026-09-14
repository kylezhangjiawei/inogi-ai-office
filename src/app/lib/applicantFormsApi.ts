import { apiFetch, authFetch, readErrorMessage } from './authSession';
import type { AiSuggestion, FormSchema, FormVersion, PublicForm, StoredFile, SubmissionDetail, SubmissionStatus, SubmissionSummary, SubmitPayload, SubmitReceipt, TemplateDetail, TemplateSummary, UploadPayload } from '../../../apps/api/src/modules/applicant-forms/types';

export type { AiSuggestion, AnswerValue, FieldStage, FieldType, FormAnswers, FormField, FormSchema, FormVersion, PublicForm, StoredFile, SubmissionDetail, SubmissionStatus, SubmissionSummary, SubmitPayload, SubmitReceipt, TemplateDetail, TemplateSummary, UploadPayload } from '../../../apps/api/src/modules/applicant-forms/types';

export class ApplicantFormsError extends Error {
  constructor(message: string, public readonly status: number) { super(message); this.name = 'ApplicantFormsError'; }
}

async function request<T>(path: string, init: RequestInit = {}, isPublic = false): Promise<T> {
  const response = await (isPublic ? apiFetch : authFetch)(`/api/${path}`, {
    ...init,
    headers: { ...(init.body ? { 'Content-Type': 'application/json' } : {}), ...init.headers },
  });
  if (!response.ok) throw new ApplicantFormsError(await readErrorMessage(response, '操作未完成，请稍后重试'), response.status);
  return response.json() as Promise<T>;
}

const admin = 'applicant-forms';
const encoded = encodeURIComponent;
export const listApplicantTemplates = (signal?: AbortSignal) => request<{ items: TemplateSummary[] }>(`${admin}/templates`, { signal });
export const getApplicantTemplate = (id: string, signal?: AbortSignal) => request<TemplateDetail>(`${admin}/templates/${encoded(id)}`, { signal });
export const createApplicantTemplate = (payload: { name?: string; schema?: FormSchema }) => request<TemplateDetail>(`${admin}/templates`, { method: 'POST', body: JSON.stringify(payload) });
export const saveApplicantTemplate = (id: string, payload: { expectedRevision: number; name?: string; schema: FormSchema }) => request<TemplateDetail>(`${admin}/templates/${encoded(id)}`, { method: 'PATCH', body: JSON.stringify(payload) });
export const publishApplicantTemplate = (id: string, expectedRevision: number) => request<{ template: TemplateDetail; version: FormVersion; publicPath: string }>(`${admin}/templates/${encoded(id)}/publish`, { method: 'POST', body: JSON.stringify({ expectedRevision }) });
export const listApplicantVersions = (id: string, signal?: AbortSignal) => request<{ items: FormVersion[] }>(`${admin}/templates/${encoded(id)}/versions`, { signal });
export const suggestApplicantForm = (schema: FormSchema, prompt: string) => request<AiSuggestion>(`${admin}/ai-suggest`, { method: 'POST', body: JSON.stringify({ schema, prompt }) });

export interface SubmissionFilters { versionId?: string; search?: string; status?: SubmissionStatus | ''; dateFrom?: string; dateTo?: string; fieldId?: string; fieldValue?: string; page?: number; pageSize?: number }
function filterQuery(filters: SubmissionFilters) {
  return new URLSearchParams(Object.entries(filters).filter(([, value]) => value !== undefined && value !== '').map(([key, value]) => [key, String(value)])).toString();
}
export const listApplicantSubmissions = (id: string, filters: SubmissionFilters, signal?: AbortSignal) => request<{ items: SubmissionSummary[]; total: number; page: number; pageSize: number }>(`${admin}/templates/${encoded(id)}/submissions?${filterQuery(filters)}`, { signal });
export const getApplicantSubmission = (id: string, signal?: AbortSignal) => request<SubmissionDetail>(`${admin}/submissions/${encoded(id)}`, { signal });
export const updateApplicantSubmission = (id: string, payload: { expectedRevision: number; status?: SubmissionStatus; note?: string }) => request<SubmissionDetail>(`${admin}/submissions/${encoded(id)}`, { method: 'PATCH', body: JSON.stringify(payload) });
export const getApplicantFileDownload = (id: string) => request<{ url: string; expiresIn: number; fileName: string; mimeType: string }>(`${admin}/files/${encoded(id)}/download`);

export const getPublicApplicantForm = (slug: string, signal?: AbortSignal) => request<PublicForm>(`public/applicant-forms/${encoded(slug)}`, { signal }, true);
export const submitPublicApplicantForm = (slug: string, payload: SubmitPayload) => request<SubmitReceipt>(`public/applicant-forms/${encoded(slug)}`, { method: 'POST', body: JSON.stringify(payload) }, true);
export const uploadPublicApplicantFile = (slug: string, payload: UploadPayload) => request<StoredFile>(`public/applicant-forms/${encoded(slug)}/files`, { method: 'POST', body: JSON.stringify(payload) }, true);
