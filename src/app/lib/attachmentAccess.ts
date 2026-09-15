import type { PreviewableAttachment } from "../components/AttachmentPreviewDialog";
import { getProcTask, type ProcurementTask } from "./procurementApi";
import { currentRdWorkspace, fetchRdTaskAttachments, type RdTaskProgressAttachment } from "./rdApi";
import { requestResourceRefresh } from "./resourceAccess";

export async function refreshRdAttachment(attachment: RdTaskProgressAttachment): Promise<RdTaskProgressAttachment> {
  if (!attachment.task_id) throw new Error("请重新打开任务后查看附件");
  const workspace = currentRdWorkspace();
  const result = await requestResourceRefresh(`rd-attachments:${workspace}:${attachment.task_id}`, () =>
    fetchRdTaskAttachments(attachment.task_id!, { force: true }));
  if (workspace !== currentRdWorkspace()) throw new Error("任务工作区已变更");
  const latest = result.attachments.find((item) => item.id === attachment.id);
  if (!latest) throw new Error("附件已删除或无权查看");
  return latest;
}

export function procurementAttachmentPreview(taskId: string, attachment: ProcurementTask["attachmentList"][number]): PreviewableAttachment {
  return {
    id: attachment.id, name: attachment.fileName, mime: attachment.mimeType,
    size: attachment.fileSize, url: attachment.fileUrl, thumbUrl: attachment.thumbUrl,
    refresh: async () => {
      const task = await requestResourceRefresh(`proc-attachments:${taskId}`, () => getProcTask(taskId));
      const latest = task.attachmentList.find((item) => item.id === attachment.id);
      if (!latest) throw new Error("附件已删除或无权查看");
      return procurementAttachmentPreview(taskId, latest);
    },
  };
}
