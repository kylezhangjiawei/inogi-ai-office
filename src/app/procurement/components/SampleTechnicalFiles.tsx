import { useState } from "react";
import { Download, Expand, FileText } from "lucide-react";

import { AttachmentPreviewDialog, type PreviewableAttachment } from "../../components/AttachmentPreviewDialog";
import { Button } from "../../components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../components/ui/select";
import { cn } from "../../components/ui/utils";
import { useI18n } from "../../lib/i18n";
import type { ProcurementTask } from "../../lib/procurementApi";
import type { RdTaskProgressAttachment } from "../../lib/rdApi";
import { TechnicalDocumentPreview, technicalPreviewKind } from "../../rd/TechnicalDocumentPreview";
import { rdDeliveryFileUrl } from "./RdDeliverySnapshotPanel";

export interface SampleTechnicalFilesProps {
  task: Pick<ProcurementTask, "id" | "attachmentList" | "rdTransferSnapshots">;
  className?: string;
}

interface SampleTechnicalFile {
  key: string;
  title: string;
  version: string | null;
  attachment: RdTaskProgressAttachment;
}

/** A saved delivery is authoritative even when its attachment list is empty. */
export function sampleTechnicalFiles(task: SampleTechnicalFilesProps["task"]): { source: "delivery" | "task"; files: SampleTechnicalFile[] } {
  const latest = task.rdTransferSnapshots?.at(-1);
  if (latest) {
    return {
      source: "delivery",
      files: latest.attachments.map((file, index) => {
        const key = `${task.id}:delivery:${latest.id}:${index}`;
        return {
          key, title: file.title?.trim() || "", version: file.version?.trim() || null,
          attachment: { id: key, name: file.fileName, mime: file.mimeType || "", size: file.fileSize, oss_url: rdDeliveryFileUrl(file.fileUrl) || "" },
        };
      }),
    };
  }
  return {
    source: "task",
    files: task.attachmentList.map((file, index) => {
      const key = `${task.id}:attachment:${file.id || index}`;
      return {
        key, title: "", version: null,
        attachment: { id: key, name: file.fileName, mime: file.mimeType || "", size: file.fileSize, oss_url: rdDeliveryFileUrl(file.fileUrl) || "" },
      };
    }),
  };
}

export function SampleTechnicalFiles(props: SampleTechnicalFilesProps) {
  // Remount local selection and an open preview when the parent switches tasks.
  return <SampleTechnicalFilesContent key={props.task.id} {...props} />;
}

function SampleTechnicalFilesContent({ task, className }: SampleTechnicalFilesProps) {
  const { t } = useI18n();
  const { source, files } = sampleTechnicalFiles(task);
  const [selection, setSelection] = useState<{ taskId: string; fileKey: string } | null>(null);
  const [expandedFile, setExpandedFile] = useState<{ taskId: string; fileKey: string } | null>(null);
  const defaultFile = files.find((file) => file.attachment.oss_url && technicalPreviewKind(file.attachment) !== "unsupported")
    ?? files.find((file) => file.attachment.oss_url) ?? files[0];
  const selected = (selection?.taskId === task.id ? files.find((file) => file.key === selection.fileKey) : undefined) ?? defaultFile;
  const expanded = expandedFile?.taskId === task.id ? files.find((file) => file.key === expandedFile.fileKey) : undefined;
  const preview: PreviewableAttachment | null = expanded?.attachment.oss_url ? {
    id: expanded.key, name: expanded.attachment.name, mime: expanded.attachment.mime,
    size: expanded.attachment.size, url: expanded.attachment.oss_url, downloadUrl: expanded.attachment.oss_url,
  } : null;
  const versionLabel = (file: SampleTechnicalFile) => file.version ? `${t("版本")} ${file.version}` : t("未登记版本");

  return (
    <section aria-label={t("样品技术资料")} className={cn("min-w-0 rounded-xl border border-border bg-card p-3 sm:p-4", className)}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-balance text-sm font-semibold text-foreground">{t("样品技术资料")}</h3>
        {files.length ? <span className="text-xs tabular-nums text-muted-foreground">{t("{count} 份文件", { count: files.length })}</span> : null}
      </div>
      <p className="mt-1 text-pretty text-xs leading-5 text-muted-foreground">{t(source === "delivery" ? "按本次交付文件核对样品，研发后续换版不会替换这里的资料。" : "未保存交付快照，以下为任务原附件；版本以原文件为准。")}</p>
      {selected ? (
        <>
          {files.length > 1 ? (
            <Select value={selected.key} onValueChange={(fileKey) => setSelection({ taskId: task.id, fileKey })}>
              <SelectTrigger aria-label={t("选择样品技术文件")} className="mt-3"><SelectValue /></SelectTrigger>
              <SelectContent>
                {files.map((file) => <SelectItem key={file.key} value={file.key}>{file.attachment.name || t("未记录文件名")} · {versionLabel(file)}</SelectItem>)}
              </SelectContent>
            </Select>
          ) : null}
          <div className="my-3 flex min-w-0 flex-wrap items-start justify-between gap-3">
            <div className="min-w-0 flex-1 basis-48">
              <p className="break-words text-pretty text-sm font-medium text-foreground">{selected.title || selected.attachment.name || t("未记录文件名")}</p>
              {selected.title && selected.title !== selected.attachment.name ? <p className="mt-0.5 break-words text-pretty text-xs text-muted-foreground">{selected.attachment.name || t("未记录文件名")}</p> : null}
              <p className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs">
                <span className={cn("font-medium", selected.version ? "text-primary" : "text-muted-foreground")}>{versionLabel(selected)}</span>
                {selected.attachment.size === 0 ? <span className="text-muted-foreground">{t("空文件")}</span> : null}
              </p>
            </div>
            {selected.attachment.oss_url ? (
              <div className="flex flex-wrap gap-2">
                <Button type="button" variant="outline" className="h-9 text-xs" onClick={() => setExpandedFile({ taskId: task.id, fileKey: selected.key })} aria-label={t("放大预览：{name}", { name: selected.attachment.name })}><Expand className="size-3.5" aria-hidden="true" />{t("放大预览")}</Button>
                <Button asChild variant="ghost" className="h-9 text-xs"><a href={selected.attachment.oss_url} download={selected.attachment.name} target="_blank" rel="noopener noreferrer" aria-label={t("下载技术文件：{name}", { name: selected.attachment.name })}><Download className="size-3.5" aria-hidden="true" />{t("下载")}</a></Button>
              </div>
            ) : null}
          </div>
          <div className="grid min-h-64 min-w-0 items-center overflow-hidden rounded-lg border border-border bg-muted/20 sm:min-h-80">
            {selected.attachment.oss_url ? (
              <TechnicalDocumentPreview key={`${selected.key}:${selected.attachment.oss_url}`} attachment={selected.attachment} />
            ) : (
              <div role="status" className="flex flex-col items-center gap-2 px-4 py-8 text-center">
                <FileText className="size-7 text-muted-foreground" aria-hidden="true" />
                <p className="text-pretty text-sm text-muted-foreground">{t("未保存可用文件地址，请核对原交付记录。")}</p>
              </div>
            )}
          </div>
        </>
      ) : (
        <div role="status" className="mt-3 flex min-h-64 flex-col items-center justify-center gap-2 rounded-lg bg-muted/40 px-4 py-8 text-center sm:min-h-80">
          <FileText className="size-7 text-muted-foreground" aria-hidden="true" />
          <p className="text-pretty text-sm text-muted-foreground">{t(source === "delivery" ? "本次交付未附带文件。" : "此任务暂无可查看的原附件。")}</p>
          <p className="text-pretty text-xs leading-5 text-muted-foreground">{t("请向研发提交人核对样品所需资料。")}</p>
        </div>
      )}
      {preview ? <AttachmentPreviewDialog key={preview.id} attachment={preview} onClose={() => setExpandedFile(null)} /> : null}
    </section>
  );
}
