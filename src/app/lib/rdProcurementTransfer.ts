import { technicalVersionAttachment, type RdTechnicalDocument } from './rdTechnicalDocumentsApi';

export interface RdTransferAttachmentChoice {
  id: string; name: string; size?: number; mimeType?: string; fileUrl: string; fileKey?: string;
  technicalDocumentVersionId?: string; versionName?: string; category?: string;
}

function fileIdentity(attachment: RdTransferAttachmentChoice): string {
  let key = attachment.fileKey;
  if (!key) {
    try { key = new URL(attachment.fileUrl, 'https://inogi.invalid').searchParams.get('key') || undefined; }
    catch { /* Non-URL legacy files keep their exact original identity. */ }
  }
  return JSON.stringify([attachment.id, key || attachment.fileUrl]);
}

/** A matching attachment ID alone is insufficient: replaced files may retain their old ID. */
export function mergeRdTransferAttachments(
  originals: RdTransferAttachmentChoice[], documents: RdTechnicalDocument[],
): RdTransferAttachmentChoice[] {
  const registered = new Map<string, RdTransferAttachmentChoice>();
  const registeredFiles = new Set<string>();
  for (const document of documents) {
    const versions = [...document.versions].sort((a, b) => Number(b.id === document.currentVersionId) - Number(a.id === document.currentVersionId));
    for (const version of versions) {
      const file = technicalVersionAttachment(version);
      const choice: RdTransferAttachmentChoice = {
        id: version.attachmentId, name: version.fileName, size: version.fileSize, mimeType: version.mimeType,
        fileUrl: file.preview_url || file.oss_url || version.fileUrl, fileKey: version.fileKey || file.object_key,
        technicalDocumentVersionId: version.id, versionName: `${version.version}${version.id === document.currentVersionId ? '' : ' · 历史'}`,
        category: version.category,
      };
      // Versions are distinct delivery choices even when they reference the same immutable file.
      if (!registered.has(version.id)) registered.set(version.id, choice);
      registeredFiles.add(fileIdentity(choice));
    }
  }
  const originalsByFile = new Map<string, RdTransferAttachmentChoice>();
  for (const original of originals) {
    const identity = fileIdentity(original);
    if (!registeredFiles.has(identity) && !originalsByFile.has(identity)) originalsByFile.set(identity, original);
  }
  return [...registered.values(), ...originalsByFile.values()];
}
