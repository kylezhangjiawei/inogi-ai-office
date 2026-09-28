import { authFetch, readErrorMessage } from './authSession';
import { RD_MUTATED_EVENT, type RdTaskProgressAttachment, type RdTaskProgressNote } from './rdApi';

export type RdTechnicalDocumentCategory = 'drawing' | 'specification' | 'bom' | 'validation' | 'other';

export interface RdTechnicalDocumentVersion {
  id: string;
  documentId: string;
  title: string;
  category: RdTechnicalDocumentCategory;
  version: string;
  changeReason: string;
  previousVersionId: string | null;
  attachmentId: string;
  sourceNoteId: string;
  fileName: string;
  mimeType: string;
  fileSize: number;
  fileKey?: string | null;
  fileUrl: string;
  createdById: string | null;
  createdByName: string;
  createdAt: string;
  attachment: RdTaskProgressAttachment;
}

export interface RdTechnicalDocument {
  id: string;
  taskId: string;
  title: string;
  category: RdTechnicalDocumentCategory;
  currentVersionId: string | null;
  versions: RdTechnicalDocumentVersion[];
}

export interface RdTechnicalDocumentsResponse {
  canEdit: boolean;
  documents: RdTechnicalDocument[];
}

export interface CreateRdTechnicalDocumentInput {
  requestId: string;
  documentId?: string;
  expectedCurrentVersionId?: string;
  title: string;
  category: RdTechnicalDocumentCategory;
  version: string;
  changeReason: string;
  sourceNoteId: string;
  attachmentId: string;
  expectedFileKey: string;
  expectedFileName: string;
  expectedFileSize: number;
}

export class RdTechnicalDocumentsError extends Error {
  constructor(message: string, public readonly status?: number) {
    super(message);
    this.name = 'RdTechnicalDocumentsError';
  }
}

async function request(taskId: string, init: RequestInit): Promise<RdTechnicalDocumentsResponse> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (init.signal?.aborted) abort();
  else init.signal?.addEventListener('abort', abort, { once: true });
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; controller.abort(); }, 30_000);
  try {
    const response = await authFetch(`/api/research-development/tasks/${encodeURIComponent(taskId)}/technical-documents`, { ...init, signal: controller.signal });
    if (!response.ok) throw new RdTechnicalDocumentsError(await readErrorMessage(response, '技术资料读取或保存失败'), response.status);
    const data = await response.json() as RdTechnicalDocumentsResponse;
    if (typeof data?.canEdit !== 'boolean' || !Array.isArray(data.documents) || data.documents.some((document) => document.taskId !== taskId || !Array.isArray(document.versions))) {
      throw new RdTechnicalDocumentsError('技术资料返回内容不完整，请重新加载');
    }
    if (init.method === 'POST' && typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(RD_MUTATED_EVENT));
    return data;
  } catch (error) {
    if (timedOut) throw new RdTechnicalDocumentsError(init.method === 'POST' ? '请求超时。保存结果可能已生效，请保留当前内容并重试确认。' : '技术资料读取超时，请重新加载。');
    throw error;
  } finally {
    clearTimeout(timer);
    init.signal?.removeEventListener('abort', abort);
  }
}

export function fetchRdTechnicalDocuments(taskId: string, signal?: AbortSignal) {
  return request(taskId, { signal });
}

export function createRdTechnicalDocument(taskId: string, input: CreateRdTechnicalDocumentInput, signal?: AbortSignal) {
  return request(taskId, { method: 'POST', body: JSON.stringify(input), signal });
}

export interface RdTechnicalAttachmentChoice {
  key: string;
  sourceNoteId: string;
  attachment: RdTaskProgressAttachment;
  uploadedBy: string;
  uploadedAt: string;
}

function sourceFileIdentity(attachment: RdTaskProgressAttachment) {
  return attachment.object_key ? `key:${attachment.object_key}` : `content:${attachment.data_url || attachment.oss_url || attachment.preview_url || ''}`;
}

/** Compact UI identity only; the server validates the expected source file before confirming. */
function selectionFingerprint(value: string) {
  let first = 0x811c9dc5;
  let second = 0x9e3779b9;
  for (let index = 0; index < value.length; index++) {
    first = Math.imul(first ^ value.charCodeAt(index), 0x01000193);
    second = Math.imul(second ^ value.charCodeAt(index), 0x85ebca6b);
  }
  return `${value.length}:${first >>> 0}:${second >>> 0}`;
}

export function isRegisteredTechnicalAttachment(choice: RdTechnicalAttachmentChoice, documents: RdTechnicalDocument[]) {
  return documents.some((document) => document.versions.some((version) => {
    if (version.sourceNoteId !== choice.sourceNoteId || version.attachmentId !== choice.attachment.id) return false;
    if (version.fileName !== choice.attachment.name || version.fileSize !== choice.attachment.size) return false;
    const sourceKey = choice.attachment.object_key || '';
    const versionKey = version.fileKey || version.attachment?.object_key || '';
    if (sourceKey || versionKey) return Boolean(sourceKey && sourceKey === versionKey);
    const sourceUrl = choice.attachment.data_url || choice.attachment.oss_url || choice.attachment.preview_url;
    const versionUrl = version.attachment?.data_url || version.attachment?.oss_url || version.fileUrl;
    // Signed snapshot URLs may differ from a legacy embedded source; keep it pending if identity is unknown.
    return Boolean(sourceUrl && sourceUrl === versionUrl);
  }));
}

/** Merged note feeds may include other tasks. Only this task's original files are eligible. */
export function collectRdTechnicalAttachments(taskId: string, notes: RdTaskProgressNote[]): RdTechnicalAttachmentChoice[] {
  const seen = new Set<string>();
  return notes.filter((note) => note.task_id === taskId).flatMap((note) => note.attachments.flatMap((attachment) => {
    const key = JSON.stringify([note.id, attachment.id, attachment.name, attachment.size, selectionFingerprint(sourceFileIdentity(attachment))]);
    if (seen.has(key)) return [];
    seen.add(key);
    return [{ key, sourceNoteId: note.id, attachment, uploadedBy: note.actor.name, uploadedAt: note.created_at }];
  })).sort((left, right) => {
    const leftTime = Date.parse(left.uploadedAt);
    const rightTime = Date.parse(right.uploadedAt);
    if (!Number.isFinite(leftTime) || !Number.isFinite(rightTime)) return 0;
    return rightTime - leftTime;
  });
}

export function technicalVersionAttachment(version: RdTechnicalDocumentVersion): RdTaskProgressAttachment {
  return {
    ...version.attachment,
    id: version.attachment?.id || version.attachmentId,
    name: version.attachment?.name || version.fileName,
    mime: version.attachment?.mime || version.mimeType,
    size: version.attachment?.size ?? version.fileSize,
    object_key: version.attachment?.object_key || version.fileKey || undefined,
    oss_url: version.attachment?.oss_url || version.fileUrl,
  };
}

export interface PreparedTechnicalDocumentRequest {
  signature: string;
  input: CreateRdTechnicalDocumentInput;
}

/** A retry retains its event ID; a changed payload requires a new explicit confirmation. */
export function prepareTechnicalDocumentRequest(
  previous: PreparedTechnicalDocumentRequest | null,
  input: Omit<CreateRdTechnicalDocumentInput, 'requestId'>,
  newId: () => string = () => crypto.randomUUID(),
): PreparedTechnicalDocumentRequest {
  const signature = JSON.stringify(input);
  return previous?.signature === signature ? previous : { signature, input: { ...input, requestId: newId() } };
}
