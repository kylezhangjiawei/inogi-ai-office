import { authFetch, readErrorMessage } from './authSession';

export type ExternalDocumentStatus = 'current' | 'review' | 'comparing' | 'failed';
export type ExternalComparisonStatus = 'comparing' | 'review' | 'archived' | 'failed';
export type ExternalDifferenceType = 'modified' | 'added' | 'removed' | 'format';
export type ExternalDifferenceRisk = 'high' | 'medium' | 'low';

export interface ExternalDocumentListItem {
  id: string;
  code: string;
  name: string;
  category: string;
  owner: string;
  currentVersion: string;
  currentFile: string;
  updatedAt: string;
  totalVersions: number;
  status: ExternalDocumentStatus;
  pendingCount: number;
  allowSend: boolean;
}

export interface ExternalDifference {
  id: string;
  type: ExternalDifferenceType;
  risk: ExternalDifferenceRisk;
  location: string;
  title: string;
  before: string;
  after: string;
  confidence: number;
  reviewed: boolean;
  source: string;
}

export interface ExternalDocumentVersion {
  id: string;
  version: string;
  fileName: string;
  fileSize: number;
  uploadedBy: string;
  uploadedAt: string;
  status: 'current' | 'pending' | 'superseded' | 'failed';
  hash: string;
  compareId?: string;
  comparisonId?: string;
  uploadRevision: number;
  replacementHistory: Array<{
    revision: number;
    fileName: string;
    fileSize: number;
    hash: string;
    uploadedBy: string;
    uploadedAt: string;
    replacedAt: string;
    replacedBy: string;
    reason: string;
  }>;
}

export interface ExternalComparison {
  id: string;
  jobCode: string;
  status: ExternalComparisonStatus;
  baseline: { id: string; version: string; fileName: string; fileSize: number } | null;
  candidate: { id: string; version: string; fileName: string; fileSize: number } | null;
  summary: string;
  differences: ExternalDifference[];
  aiModel: string | null;
  aiProvider: string | null;
  ocrProvider: string | null;
  ocrConfidence: number | null;
  errorMessage: string | null;
  completedAt: string | null;
  archivedAt: string | null;
}

export interface ExternalIntegrationStatus {
  ai: { configured: boolean; provider: string | null; model: string | null };
  ocr: { configured: boolean; provider: string; source: string };
}

export interface ExternalDocumentDetail {
  document: ExternalDocumentListItem;
  versions: ExternalDocumentVersion[];
  comparison: ExternalComparison | null;
  integration: ExternalIntegrationStatus;
}

export interface ExternalDocumentListResponse {
  items: ExternalDocumentListItem[];
  total: number;
  integration: ExternalIntegrationStatus;
}

async function parseResponse<T>(response: Response, fallback: string): Promise<T> {
  if (!response.ok) throw new Error(await readErrorMessage(response, fallback));
  return response.json() as Promise<T>;
}

export async function listExternalDocuments(signal?: AbortSignal) {
  const response = await authFetch('/api/external-docs', { signal });
  return parseResponse<ExternalDocumentListResponse>(response, '读取对外资料失败');
}

export async function getExternalDocument(documentId: string, signal?: AbortSignal) {
  const response = await authFetch(`/api/external-docs/${encodeURIComponent(documentId)}`, { signal });
  return parseResponse<ExternalDocumentDetail>(response, '读取资料版本详情失败');
}

export async function getExternalDocumentVersionDownload(versionId: string, revision?: number) {
  const query = revision == null ? '' : `?revision=${encodeURIComponent(String(revision))}`;
  const response = await authFetch(`/api/external-docs/versions/${encodeURIComponent(versionId)}/download${query}`);
  return parseResponse<{
    versionId: string;
    revision: number;
    fileName: string;
    hash: string;
    url: string;
    expiresIn: number;
  }>(response, '读取资料原文件失败');
}

export async function replaceExternalComparisonCandidate(comparisonId: string, input: {
  file: File;
  reason?: string;
}) {
  const form = new FormData();
  form.append('file', input.file);
  if (input.reason) form.append('reason', input.reason);
  const response = await authFetch(`/api/external-docs/comparisons/${encodeURIComponent(comparisonId)}/replace-candidate`, {
    method: 'POST',
    body: form,
  });
  return parseResponse<ExternalDocumentDetail>(response, '纠正候选文件失败');
}

export async function createExternalDocument(input: {
  file: File;
  name: string;
  category: string;
  version: string;
  notes?: string;
}) {
  const form = new FormData();
  form.append('file', input.file);
  form.append('name', input.name);
  form.append('category', input.category);
  form.append('version', input.version);
  if (input.notes) form.append('notes', input.notes);
  const response = await authFetch('/api/external-docs', { method: 'POST', body: form });
  return parseResponse<ExternalDocumentDetail>(response, '建立资料首版失败');
}

export async function uploadExternalDocumentVersion(documentId: string, input: {
  file: File;
  version: string;
  notes?: string;
}) {
  const form = new FormData();
  form.append('file', input.file);
  form.append('version', input.version);
  if (input.notes) form.append('notes', input.notes);
  const response = await authFetch(`/api/external-docs/${encodeURIComponent(documentId)}/versions`, {
    method: 'POST',
    body: form,
  });
  return parseResponse<ExternalDocumentDetail>(response, '上传资料新版本失败');
}

export async function reviewExternalDifference(comparisonId: string, differenceId: string, reviewed: boolean) {
  const response = await authFetch(`/api/external-docs/comparisons/${encodeURIComponent(comparisonId)}/review`, {
    method: 'PUT',
    body: JSON.stringify({ differenceId, reviewed }),
  });
  return parseResponse<{ differences: ExternalDifference[]; reviewedCount: number }>(response, '保存复核结果失败');
}

export async function reviewAllExternalDifferences(comparisonId: string) {
  const response = await authFetch(`/api/external-docs/comparisons/${encodeURIComponent(comparisonId)}/review-all`, {
    method: 'PUT',
    body: JSON.stringify({}),
  });
  return parseResponse<{ differences: ExternalDifference[]; reviewedCount: number }>(response, '批量复核失败');
}

export async function regenerateExternalComparisonSummary(comparisonId: string) {
  const response = await authFetch(`/api/external-docs/comparisons/${encodeURIComponent(comparisonId)}/regenerate-summary`, {
    method: 'POST',
    body: JSON.stringify({}),
  });
  return parseResponse<{ summary: string; model: string; provider: string }>(response, '重新生成摘要失败');
}

export async function archiveExternalComparison(comparisonId: string, summary: string) {
  const response = await authFetch(`/api/external-docs/comparisons/${encodeURIComponent(comparisonId)}/archive`, {
    method: 'POST',
    body: JSON.stringify({ summary }),
  });
  return parseResponse<ExternalDocumentDetail>(response, '归档资料新版本失败');
}

export async function retryExternalComparison(comparisonId: string) {
  const response = await authFetch(`/api/external-docs/comparisons/${encodeURIComponent(comparisonId)}/retry`, {
    method: 'POST',
    body: JSON.stringify({}),
  });
  return parseResponse<ExternalDocumentDetail>(response, '重试 AI/OCR 比对失败');
}
