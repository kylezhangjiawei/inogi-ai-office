import { refreshFileReadUrl, requestResourceRefresh } from "../resourceAccess";
import type { Attachment, IssueService } from "./types";

/** Shared issue attachments must be re-authorized through their issue, not uploader-only FilesService. */
export async function refreshIssueAttachment(
  service: Pick<IssueService, "get">,
  issueId: string,
  attachmentId: string,
): Promise<Attachment> {
  const issue = await requestResourceRefresh(`issue-attachments:${issueId}`, () => service.get(issueId));
  const attachment = [
    ...issue.attachments,
    ...issue.messages.flatMap((message) => message.attachments ?? []),
  ].find((item) => item.id === attachmentId);
  if (!attachment?.fileUrl) throw new Error("附件已不可用，请重新打开问题详情");
  return attachment;
}

/** Unsubmitted files still belong to the current uploader and have no containing issue yet. */
export async function refreshDraftIssueAttachment(attachment: Attachment): Promise<Attachment> {
  if (!attachment.id) throw new Error("附件尚未上传完成");
  return { ...attachment, fileUrl: await refreshFileReadUrl(attachment.id) };
}
