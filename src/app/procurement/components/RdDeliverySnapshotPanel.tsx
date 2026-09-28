import { useState } from "react";
import { ChevronDown, Download, Eye, FileText, History } from "lucide-react";

import { AttachmentPreviewDialog, type PreviewableAttachment } from "../../components/AttachmentPreviewDialog";
import { Button } from "../../components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "../../components/ui/collapsible";
import { cn } from "../../components/ui/utils";
import { useI18n } from "../../lib/i18n";
import type { ProcurementTask, RdProcurementTransferSnapshot } from "../../lib/procurementApi";

type DeliveryFile = RdProcurementTransferSnapshot["attachments"][number];

export interface RdDeliverySnapshotPanelProps {
  task: Pick<ProcurementTask, "id" | "rdTransferSnapshots">;
  compact?: boolean;
  className?: string;
}

/** Keep server-issued snapshot URLs intact; never resolve a document's current version here. */
export function rdDeliveryFileUrl(value: string): string | null {
  const url = value?.trim();
  if (!url || /[\u0000-\u001f\u007f\\]/.test(url)) return null;
  if (/^\/(?!\/)/.test(url)) return url;
  if (/^https?:\/\//i.test(url)) {
    try { return new URL(url).hostname ? url : null; } catch { return null; }
  }
  // Legacy transfers can contain embedded files. Active document types stay unavailable.
  if (/^data:(?:image\/(?:png|jpe?g|gif|webp|avif|bmp)|application\/(?:pdf|json|octet-stream|vnd\.ms-excel|vnd\.openxmlformats-officedocument\.spreadsheetml\.sheet)|text\/plain)(?:;[^,]*)?,/i.test(url)) return url;
  return null;
}

export function rdDeliveryPreviewAttachment(snapshotId: string, file: DeliveryFile, index: number): PreviewableAttachment | null {
  const url = rdDeliveryFileUrl(file.fileUrl);
  if (!url) return null;
  return {
    id: `${snapshotId}:${index}`,
    name: file.fileName,
    mime: file.mimeType || undefined,
    size: file.fileSize,
    url,
    downloadUrl: url,
  };
}

function savedDate(value: string | null, locale: string): string | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toLocaleString(locale, {
    year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
  }) : null;
}

function savedFileSize(size: number): string | null {
  if (!Number.isFinite(size) || size < 0) return null;
  if (size >= 1024 * 1024) return `${(size / 1024 / 1024).toFixed(1)} MB`;
  if (size >= 1024) return `${Math.ceil(size / 1024)} KB`;
  return `${size} B`;
}

/** Procurement receives an immutable delivery history, independently of current R&D files. */
export function RdDeliverySnapshotPanel({ task, compact = false, className }: RdDeliverySnapshotPanelProps) {
  const { t } = useI18n();
  const [selection, setSelection] = useState<{ taskId: string; snapshotId: string; index: number } | null>(null);
  // The API preserves append order, including repeated submissions with the same timestamp.
  const snapshots = task.rdTransferSnapshots ?? [];
  const latest = snapshots.at(-1);
  const history = snapshots.slice(0, -1).reverse();
  const selectedSnapshot = selection?.taskId === task.id
    ? snapshots.find((snapshot) => snapshot.id === selection.snapshotId) : undefined;
  const selectedFile = selectedSnapshot && selection ? selectedSnapshot.attachments[selection.index] : undefined;
  const preview = selectedSnapshot && selectedFile && selection
    ? rdDeliveryPreviewAttachment(selectedSnapshot.id, selectedFile, selection.index) : null;
  const openFile = (snapshotId: string, index: number) => setSelection({ taskId: task.id, snapshotId, index });

  return (
    <section aria-label={t("研发交付资料")} className={cn("min-w-0 rounded-xl border border-border bg-card", compact ? "p-3" : "p-4", className)}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-balance text-sm font-semibold text-foreground">{t("研发交付资料")}</h3>
        {latest ? <span className="text-xs tabular-nums text-muted-foreground">{t("{count} 次交付", { count: snapshots.length })}</span> : null}
      </div>
      {latest ? (
        <>
          <p className="mt-1 text-pretty text-xs leading-5 text-muted-foreground">{t("按提交时内容保存；研发后续换版不会替换这次交付。")}</p>
          <div className="mt-3">
            <SnapshotRecord snapshot={latest} label={t("本次交付")} compact={compact} onPreview={openFile} />
          </div>
          {history.length > 0 ? (
            <Collapsible key={task.id} className="mt-3 border-t border-border pt-2">
              <CollapsibleTrigger asChild>
                <Button type="button" variant="ghost" className="group h-auto min-h-10 w-full justify-between px-2 text-xs">
                  <span className="inline-flex items-center gap-2"><History className="size-4" aria-hidden="true" />{t("历史交付")}<span className="tabular-nums text-muted-foreground">{history.length}</span></span>
                  <ChevronDown className="size-4 group-data-[state=open]:rotate-180" aria-hidden="true" />
                </Button>
              </CollapsibleTrigger>
              <CollapsibleContent className="space-y-3 pt-2">
                {history.map((snapshot, index) => (
                  <SnapshotRecord key={snapshot.id} snapshot={snapshot} label={t("第 {number} 次交付", { number: snapshots.length - index - 1 })} compact={compact} onPreview={openFile} />
                ))}
              </CollapsibleContent>
            </Collapsible>
          ) : null}
        </>
      ) : (
        <div className="mt-3 rounded-lg bg-muted/40 p-3">
          <p className="text-pretty text-sm text-muted-foreground">{t("历史采购未保存交付版本快照，原附件与记录仍保留。")}</p>
          <p className="mt-1 text-pretty text-xs leading-5 text-muted-foreground">{t("请在任务附件和操作记录中核对原交付内容。")}</p>
        </div>
      )}
      {preview ? <AttachmentPreviewDialog key={preview.id} attachment={preview} onClose={() => setSelection(null)} /> : null}
    </section>
  );
}

function SnapshotRecord({ snapshot, label, compact, onPreview }: {
  snapshot: RdProcurementTransferSnapshot;
  label: string;
  compact: boolean;
  onPreview: (snapshotId: string, index: number) => void;
}) {
  const { t, lang } = useI18n();
  const requirement = snapshot.requirement;
  const submittedAt = savedDate(snapshot.submittedAt, lang === "en" ? "en-US" : "zh-CN");
  const purchaseLink = requirement.purchaseLink && rdDeliveryFileUrl(requirement.purchaseLink);
  return (
    <article aria-label={label} className={cn("min-w-0 rounded-lg border border-border", compact ? "p-3" : "p-3 sm:p-4")}>
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
        <h4 className="text-balance text-sm font-semibold text-primary">{label}</h4>
        <span className="text-xs tabular-nums text-muted-foreground">{t("{count} 份文件", { count: snapshot.attachments.length })}</span>
      </div>
      <p className="mt-1 flex flex-wrap gap-x-2 gap-y-1 text-xs text-muted-foreground">
        <span>{t("提交人")}：{snapshot.submittedByName?.trim() || t("未记录提交人")}</span>
        <span className="tabular-nums">{t("提交时间")}：{submittedAt ? <time dateTime={snapshot.submittedAt}>{submittedAt}</time> : t("未记录日期")}</span>
      </p>
      {snapshot.rdTaskTitle ? <p className="mt-2 break-words text-pretty text-xs leading-5 text-muted-foreground">{t("研发任务")}：{snapshot.rdTaskTitle}</p> : null}
      <dl className="mt-3 grid min-w-0 grid-cols-2 gap-x-4 gap-y-3 rounded-lg bg-muted/40 p-3 text-xs">
        <div className="col-span-2 min-w-0">
          <dt className="text-muted-foreground">{t("需求物料")}</dt>
          <dd className="mt-1 break-words text-pretty font-medium text-foreground">{requirement.materialName || t("未记录物料名称")}</dd>
        </div>
        <div className="col-span-2 min-w-0">
          <dt className="text-muted-foreground">{t("需求规格")}</dt>
          <dd className="mt-1 whitespace-pre-wrap break-words text-pretty text-foreground">{requirement.spec || t("规格未填写")}</dd>
        </div>
        <div className="col-span-2 min-w-0">
          <dt className="text-muted-foreground">{t("需求数量")}</dt>
          <dd className="mt-1 break-words font-semibold tabular-nums text-foreground">{Number.isFinite(requirement.quantity) ? requirement.quantity : t("未记录数量")} {requirement.unit || t("单位未填写")}</dd>
        </div>
        {requirement.needDateNotApplicableReason && <div className="col-span-2 min-w-0"><dt className="text-muted-foreground">{t("需求日期不适用原因")}</dt><dd className="mt-1 whitespace-pre-wrap break-words">{requirement.needDateNotApplicableReason}</dd></div>}
        {requirement.specNotApplicableReason && <div className="col-span-2 min-w-0"><dt className="text-muted-foreground">{t("规格 / 图纸不适用原因")}</dt><dd className="mt-1 whitespace-pre-wrap break-words">{requirement.specNotApplicableReason}</dd></div>}
        {requirement.needDate ? <div className="min-w-0"><dt className="text-muted-foreground">{t("需求日期")}</dt><dd className="mt-1 break-words tabular-nums text-foreground">{requirement.needDate}</dd></div> : null}
        {requirement.deadline ? <div className="min-w-0"><dt className="text-muted-foreground">{t("采购截止日期")}</dt><dd className="mt-1 break-words tabular-nums text-foreground">{requirement.deadline}</dd></div> : null}
        {requirement.note ? <div className="col-span-2 min-w-0"><dt className="text-muted-foreground">{t("交付备注")}</dt><dd className="mt-1 whitespace-pre-wrap break-words text-pretty text-foreground">{requirement.note}</dd></div> : null}
        {purchaseLink && /^https?:\/\//i.test(purchaseLink) ? <div className="col-span-2"><a href={purchaseLink} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-9 items-center rounded text-primary underline underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">{t("查看提交时的采购参考链接")}</a></div> : null}
      </dl>
      {snapshot.attachments.length ? (
        <ul className="mt-3 divide-y divide-border" aria-label={t("交付文件")}>
          {snapshot.attachments.map((file, index) => {
            const url = rdDeliveryFileUrl(file.fileUrl);
            const fileSize = savedFileSize(file.fileSize);
            return (
              <li key={`${snapshot.id}:${index}`} className="min-w-0 py-3 first:pt-0 last:pb-0">
                <div className="flex min-w-0 items-start gap-2">
                  <FileText className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                  <div className="min-w-0 flex-1">
                    <p className="break-words text-pretty text-sm font-medium text-foreground">{file.title?.trim() || file.fileName || t("未命名文件")}</p>
                    {file.title && file.title !== file.fileName ? <p className="mt-0.5 break-words text-pretty text-xs text-muted-foreground">{file.fileName || t("未记录文件名")}</p> : null}
                    <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                      <span className={cn("font-medium", file.version?.trim() ? "text-primary" : "text-muted-foreground")}>{file.version?.trim() ? `${t("版本")} ${file.version}` : t("未登记版本")}</span>
                      <span className="tabular-nums text-muted-foreground">{fileSize ?? t("未记录文件大小")}{file.fileSize === 0 ? ` · ${t("空文件")}` : ""}</span>
                    </div>
                  </div>
                </div>
                {url ? (
                  <div className="mt-2 flex flex-wrap gap-2 pl-6">
                    <Button type="button" variant="outline" className="h-9 text-xs" aria-label={t("预览交付文件：{name}", { name: file.fileName })} onClick={() => onPreview(snapshot.id, index)}><Eye className="size-3.5" aria-hidden="true" />{t("预览")}</Button>
                    <Button asChild variant="ghost" className="h-9 text-xs"><a href={url} download={file.fileName} target="_blank" rel="noopener noreferrer" aria-label={t("下载交付文件：{name}", { name: file.fileName })}><Download className="size-3.5" aria-hidden="true" />{t("下载")}</a></Button>
                  </div>
                ) : <p className="mt-2 pl-6 text-pretty text-xs text-muted-foreground">{t("未保存可用文件地址，请核对原交付记录。")}</p>}
              </li>
            );
          })}
        </ul>
      ) : <p className="mt-3 text-pretty text-xs text-muted-foreground">{t("本次交付未附带文件。")}</p>}
    </article>
  );
}
