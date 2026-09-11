export type RdAttachmentPayloadItem = {
  id: string;
  task_id?: string;
  name: string;
  mime: string;
  size: number;
  object_key?: string;
  preview_url?: string;
  download_url?: string;
  thumb_url?: string;
  oss_url?: string;
  data_url?: string;
};

type RdAttachmentPayloadNote = {
  task_id?: string;
  created_at?: string;
  attachments?: Array<RdAttachmentPayloadItem & {
    extracted_text?: unknown;
    extracted_source?: unknown;
    extracted_at?: unknown;
  }>;
};

export type RdAttachmentPayload = {
  attachment_count: number;
  attachments: RdAttachmentPayloadItem[];
};

/**
 * Convert the legacy full-note response into the same lightweight shape used by the optimized
 * attachment endpoints. `previewLimit` affects only the returned preview array, never the total.
 */
export function buildRdTaskAttachmentPayload(
  notes: RdAttachmentPayloadNote[],
  previewLimit?: number,
): RdAttachmentPayload {
  const allAttachments = notes
    .slice()
    .sort((a, b) => String(b.created_at ?? "").localeCompare(String(a.created_at ?? "")))
    .flatMap((note) => (note.attachments ?? []).map((attachment) => ({ ...attachment, task_id: attachment.task_id ?? note.task_id })));
  const selected = typeof previewLimit === "number"
    ? [
        ...allAttachments.filter((attachment) => attachment.mime.startsWith("image/")),
        ...allAttachments.filter((attachment) => !attachment.mime.startsWith("image/")),
      ].slice(0, Math.max(0, previewLimit))
    : allAttachments;
  return {
    attachment_count: allAttachments.length,
    attachments: selected.map((attachment) => ({
      id: attachment.id,
      ...(attachment.task_id ? { task_id: attachment.task_id } : {}),
      name: attachment.name,
      mime: attachment.mime,
      size: attachment.size,
      ...(attachment.object_key ? { object_key: attachment.object_key } : {}),
      ...(attachment.preview_url ? { preview_url: attachment.preview_url } : {}),
      ...(attachment.download_url ? { download_url: attachment.download_url } : {}),
      ...(attachment.thumb_url ? { thumb_url: attachment.thumb_url } : {}),
      ...(attachment.oss_url ? { oss_url: attachment.oss_url } : {}),
      ...(attachment.data_url ? { data_url: attachment.data_url } : {}),
    })),
  };
}
