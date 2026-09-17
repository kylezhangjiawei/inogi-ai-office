import { useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Download, FileText, ImageOff, Loader2, Table2, X } from "lucide-react";

import { useI18n } from "../lib/i18n";
import { downloadResource } from "../lib/resourceAccess";
import { useRenewableResource } from "../lib/useRenewableResource";
import { parseXlsxForPreview, type XlsxPreviewSheet } from "../lib/xlsxPreview";
import { MobileZoomableImage } from "./MobileZoomableImage";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle } from "./ui/dialog";
import { cn } from "./ui/utils";
import { Button } from "./ui/button";

export type PreviewableAttachment = {
  id?: string;
  name: string;
  mime?: string;
  size?: number;
  url: string;
  previewUrl?: string;
  thumbUrl?: string;
  downloadUrl?: string;
  /** Re-read through the containing business record's authorized endpoint. */
  refresh?: () => Promise<PreviewableAttachment>;
};

const MIME_BY_EXTENSION: Record<string, string> = {
  bmp: "image/bmp",
  gif: "image/gif",
  jpeg: "image/jpeg",
  jpg: "image/jpeg",
  json: "application/json",
  mov: "video/quicktime",
  mp3: "audio/mpeg",
  mp4: "video/mp4",
  pdf: "application/pdf",
  png: "image/png",
  svg: "image/svg+xml",
  txt: "text/plain",
  wav: "audio/wav",
  webm: "video/webm",
  webp: "image/webp",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
};

/**
 * 按扩展名兜底推断 mime。部分上传来源（旧数据、合并迁移、未声明 Content-Type 的客户端）
 * 会把 PDF 之类存成 application/octet-stream，只认 mime 字段会让这些文件白白失去内嵌预览。
 */
export function inferAttachmentMime(attachment: { name?: string; mime?: string }): string {
  const declared = attachment.mime?.trim().toLowerCase();
  if (declared && declared !== "application/octet-stream") return declared;
  const extension = attachment.name?.split(".").pop()?.toLowerCase() ?? "";
  return MIME_BY_EXTENSION[extension] ?? declared ?? "application/octet-stream";
}

function attachmentMime(attachment: PreviewableAttachment): string {
  return inferAttachmentMime(attachment);
}

function isSpreadsheetAttachment(attachment: PreviewableAttachment, mime: string): boolean {
  const extension = attachment.name.split(".").pop()?.toLowerCase() ?? "";
  return extension === "xlsx" || extension === "xls" || mime.includes("spreadsheetml") || mime.includes("ms-excel");
}

function formatFileSize(size = 0): string {
  if (!Number.isFinite(size) || size <= 0) return "0 B";
  if (size >= 1024 * 1024) return `${(size / 1024 / 1024).toFixed(1)} MB`;
  if (size >= 1024) return `${Math.ceil(size / 1024)} KB`;
  return `${size} B`;
}

function isMobileRoute(): boolean {
  return document.documentElement.classList.contains("mobile-route");
}

export function AttachmentPreviewDialog({
  attachment,
  attachments,
  onClose,
}: {
  attachment: PreviewableAttachment;
  attachments?: PreviewableAttachment[];
  onClose: () => void;
}) {
  const { t } = useI18n();
  const requestedKey = attachmentKey(attachment);
  const [selection, setSelection] = useState({ requestedKey, activeKey: requestedKey });
  const items = [...new Map((attachments?.length ? attachments : [attachment]).map((item) => [attachmentKey(item), item])).values()];
  if (!items.some((item) => attachmentKey(item) === requestedKey)) items.unshift(attachment);
  const selectedKey = selection.requestedKey === requestedKey ? selection.activeKey : requestedKey;
  const selectedIndex = items.findIndex((item) => attachmentKey(item) === selectedKey);
  const activeIndex = selectedIndex >= 0 ? selectedIndex : items.findIndex((item) => attachmentKey(item) === requestedKey);
  const activeAttachment = items[activeIndex];
  const activeKey = attachmentKey(activeAttachment);
  const mime = attachmentMime(activeAttachment);
  const downloadUrl = activeAttachment.downloadUrl || activeAttachment.url;
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState(false);
  const openerRef = useRef(document.activeElement instanceof HTMLElement ? document.activeElement : null);
  const selectedThumbnailRef = useRef<HTMLButtonElement>(null);
  const hasGallery = items.length > 1;
  const selectAttachment = (index: number) => {
    if (index < 0 || index >= items.length) return;
    setSelection({ requestedKey, activeKey: attachmentKey(items[index]) });
  };

  useEffect(() => {
    selectedThumbnailRef.current?.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "instant" });
    setDownloadError(false);
  }, [activeKey]);

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent
        className="horizon-portal flex h-[90dvh] min-w-0 flex-col gap-0 overflow-hidden rounded-xl border-slate-200 bg-white p-0 shadow-xl data-[state=open]:animate-none data-[state=closed]:animate-none sm:max-w-7xl [&>button.absolute]:hidden"
        onCloseAutoFocus={(event) => {
          // Callers open this dialog from several conditional attachment controls, without a DialogTrigger.
          if (openerRef.current?.isConnected) {
            event.preventDefault();
            openerRef.current.focus();
          }
        }}
        onPointerDownOutside={(event) => { if (isMobileRoute()) event.preventDefault(); }}
        onKeyDown={(event) => {
          if (event.defaultPrevented || event.nativeEvent.isComposing || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
          if (event.target instanceof Element && event.target.closest('input, textarea, select, [contenteditable="true"], [role="textbox"], [role="slider"], [role="combobox"], video, audio, [data-attachment-local-keys]')) return;
          if (!hasGallery || (event.key !== "ArrowLeft" && event.key !== "ArrowRight")) return;
          event.preventDefault();
          selectAttachment(activeIndex + (event.key === "ArrowLeft" ? -1 : 1));
        }}
      >
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-slate-200 px-3 py-3 sm:px-5">
          <div className="min-w-0">
            <DialogTitle className="truncate text-balance text-sm font-semibold text-[#1b2559]" title={activeAttachment.name}>{activeAttachment.name}</DialogTitle>
            <DialogDescription className="mt-1 truncate text-xs leading-4 tabular-nums text-slate-500">
              {hasGallery ? t("第 {current} / {total} 个附件", { current: activeIndex + 1, total: items.length }) : t("附件预览")} · {formatFileSize(activeAttachment.size)}
            </DialogDescription>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <a
              href={downloadUrl}
              download={activeAttachment.name}
              target="_blank"
              rel="noopener noreferrer"
              aria-disabled={downloading}
              onClick={(event) => {
                event.preventDefault();
                if (downloading) return;
                setDownloading(true);
                setDownloadError(false);
                void downloadResource(downloadUrl, activeAttachment.name, activeAttachment.refresh ? async () => {
                  const latest = await activeAttachment.refresh!();
                  return latest.downloadUrl || latest.url;
                } : undefined).catch(() => setDownloadError(true)).finally(() => setDownloading(false));
              }}
              className="inline-flex h-10 items-center gap-1.5 rounded-lg border border-[var(--primary-soft-border)] bg-white px-3 text-xs font-semibold text-primary hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
            >
              <Download className="size-4" aria-hidden="true" />
              {t(downloading ? "正在下载…" : "下载")}
            </a>
            {downloadError ? <span role="alert" className="text-xs text-red-600">{t("下载失败，请重试")}</span> : null}
            <DialogClose asChild>
              <Button variant="unstyled"
                type="button"
                className="flex size-10 cursor-pointer items-center justify-center rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50 hover:text-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
                aria-label={t("关闭预览")}
              >
                <X className="size-4" aria-hidden="true" />
              </Button>
            </DialogClose>
          </div>
        </div>

        <div className="flex min-h-0 min-w-0 flex-1 overflow-hidden bg-slate-100 p-2 sm:p-4">
          <AttachmentContent key={`${activeKey}:${activeAttachment.previewUrl || activeAttachment.url}`} attachment={activeAttachment} mime={mime} />
        </div>
        {hasGallery ? (
          <div className="min-w-0 shrink-0 border-t border-slate-200 bg-white px-3 pb-3 pt-2 sm:px-5">
            <div className="mb-2 flex items-center justify-between gap-2">
              <div className="min-w-0 text-xs font-medium text-slate-600">{t("全部附件")} <span className="tabular-nums text-muted-foreground">{items.length}</span></div>
              <nav aria-label={t("切换预览附件")} className="flex shrink-0 items-center gap-2">
                <Button variant="unstyled" type="button" disabled={activeIndex === 0} onClick={() => selectAttachment(activeIndex - 1)} aria-label={t("上一个附件")} className="inline-flex h-9 items-center gap-1 rounded-lg border border-[var(--primary-soft-border)] px-2 text-xs text-primary hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 disabled:cursor-not-allowed disabled:opacity-40">
                  <ChevronLeft className="size-4" aria-hidden="true" />{t(mime.startsWith("image/") ? "上一张" : "上一项")}
                </Button>
                <span aria-live="polite" aria-atomic="true" className="min-w-10 text-center text-xs tabular-nums text-slate-500">{activeIndex + 1} / {items.length}</span>
                <Button variant="unstyled" type="button" disabled={activeIndex === items.length - 1} onClick={() => selectAttachment(activeIndex + 1)} aria-label={t("下一个附件")} className="inline-flex h-9 items-center gap-1 rounded-lg border border-[var(--primary-soft-border)] px-2 text-xs text-primary hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 disabled:cursor-not-allowed disabled:opacity-40">
                  {t(mime.startsWith("image/") ? "下一张" : "下一项")}<ChevronRight className="size-4" aria-hidden="true" />
                </Button>
              </nav>
            </div>
            <div className="flex min-w-0 gap-2 overflow-x-auto overscroll-x-contain pb-1" role="group" aria-label={t("全部附件缩略图")}>
              {items.map((item, index) => (
                <Button variant="unstyled"
                  key={attachmentKey(item)}
                  ref={index === activeIndex ? selectedThumbnailRef : undefined}
                  type="button"
                  onClick={() => selectAttachment(index)}
                  aria-label={t("预览第 {index} 个附件：{name}", { index: index + 1, name: item.name })}
                  aria-current={index === activeIndex ? "true" : undefined}
                  title={item.name}
                  className={cn("w-24 shrink-0 overflow-hidden rounded-lg border-2 p-1 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30", index === activeIndex ? "border-[var(--primary)] bg-accent" : "border-transparent bg-slate-50 hover:border-slate-200")}
                >
                  <AttachmentThumbnail attachment={item} />
                  <div className="mt-1 truncate text-xs text-slate-600">{item.name}</div>
                </Button>
              ))}
            </div>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function attachmentKey(attachment: PreviewableAttachment): string {
  return attachment.id ? `id:${attachment.id}` : `url:${attachment.url}:${attachment.name}`;
}

function AttachmentThumbnail({ attachment }: { attachment: PreviewableAttachment }) {
  const image = useRenewableResource({
    src: attachment.thumbUrl || attachment.previewUrl || attachment.url,
    resourceKey: `attachment-thumb:${attachmentKey(attachment)}`,
    refresh: attachment.refresh ? async () => { const latest = await attachment.refresh!(); return latest.thumbUrl || latest.previewUrl || latest.url; } : undefined,
  });
  const isImage = attachmentMime(attachment).startsWith("image/");
  return (
    <div className="flex h-14 items-center justify-center overflow-hidden rounded bg-white text-muted-foreground">
      {isImage && !image.failed ? <img src={image.src || undefined} alt="" loading="lazy" decoding="async" className="h-full w-full object-contain" onLoad={image.onLoad} onError={image.onError} /> : <FileText className="size-6" aria-hidden="true" />}
    </div>
  );
}

function AttachmentContent({ attachment, mime }: { attachment: PreviewableAttachment; mime: string }) {
  const { t } = useI18n();
  const resource = useRenewableResource({
    src: attachment.previewUrl || attachment.url,
    resourceKey: `attachment-preview:${attachmentKey(attachment)}`,
    refresh: attachment.refresh ? async () => { const latest = await attachment.refresh!(); return latest.previewUrl || latest.url; } : undefined,
    refreshOnMount: true,
  });
  const previewUrl = resource.src;
  const imageFailed = resource.failed;
  const [imageLoading, setImageLoading] = useState(true);
  if (resource.refreshing) return <div role="status" className="flex flex-1 items-center justify-center text-sm text-slate-500">{t("正在加载附件…")}</div>;
  if (resource.failed && !mime.startsWith("image/")) return <div role="alert" className="p-6 text-sm text-slate-500">{t("附件加载失败，请重新打开或下载查看。")}</div>;
  if (mime.startsWith("image/")) {
    return (
      <div className="relative flex min-h-0 min-w-0 flex-1 items-center justify-center overflow-hidden rounded-lg bg-white" data-attachment-local-keys>
        {imageFailed ? (
          <div role="status" className="flex max-w-md flex-col items-center gap-3 p-6 text-center">
            <ImageOff className="size-10 text-muted-foreground" aria-hidden="true" />
            <div className="text-balance text-sm font-semibold text-[#1b2559]">{t("图片加载失败")}</div>
            <p className="text-pretty text-xs leading-5 text-slate-500">{t("可切换其他附件，或点击右上角下载查看。")}</p>
          </div>
        ) : (
          <>
            {imageLoading ? <div role="status" aria-label={t("正在加载图片")} className="pointer-events-none absolute inset-4 rounded-lg bg-slate-50" /> : null}
            <MobileZoomableImage src={previewUrl} alt={attachment.name} loading="eager" decoding="async" enabled controlsPlacement="below" stopPropagation={false} onLoad={() => { resource.onLoad(); setImageLoading(false); }} onError={resource.onError} className="h-full w-full" imageClassName="h-full w-full object-contain" />
          </>
        )}
      </div>
    );
  }
  if (mime.startsWith("video/")) return <div className="flex min-h-0 min-w-0 flex-1 items-center justify-center"><video src={previewUrl} onError={resource.onError} onLoadedData={resource.onLoad} controls autoPlay playsInline className="h-full max-h-full w-full rounded-lg bg-slate-950 object-contain">{t("当前浏览器暂不支持视频播放")}</video></div>;
  if (mime.startsWith("audio/")) return <div className="flex min-h-0 min-w-0 flex-1 items-center justify-center"><audio src={previewUrl} onError={resource.onError} onLoadedData={resource.onLoad} controls autoPlay className="w-full max-w-xl" /></div>;
  if (isSpreadsheetAttachment(attachment, mime)) return <div className="min-h-0 min-w-0 flex-1 overflow-auto"><XlsxTablePreview url={previewUrl} /></div>;
  if (mime === "application/pdf" || mime === "text/plain" || mime === "application/json") {
    return (
      <iframe
        /* Do not add sandbox: it disables the built-in PDF viewer. The OSS preview proxy applies its document CSP and forces active content to download. */
        src={previewUrl}
        title={attachment.name}
        referrerPolicy="no-referrer"
        className="h-full min-h-0 min-w-0 flex-1 rounded-lg border border-slate-200 bg-white"
      />
    );
  }
  return <div className="min-h-0 min-w-0 flex-1 overflow-auto"><UnsupportedPreview /></div>;
}

function UnsupportedPreview() {
  const { t } = useI18n();
  return (
    <div className="mx-auto flex min-h-[52vh] max-w-lg flex-col items-center justify-center rounded-lg border border-dashed border-slate-300 bg-white px-8 text-center">
      <FileText className="h-10 w-10 text-muted-foreground" />
      <div className="mt-4 text-balance text-sm font-semibold text-[#1b2559]">{t("当前格式暂不支持内嵌预览")}</div>
      <p className="mt-2 text-pretty text-xs leading-5 text-slate-500">{t("文件已保留在当前任务中，可直接下载查看，不会离开采购驾驶舱页面。")}</p>
    </div>
  );
}

function XlsxTablePreview({ url }: { url: string }) {
  const { t } = useI18n();
  const [sheets, setSheets] = useState<XlsxPreviewSheet[] | null>(null);
  const [active, setActive] = useState(0);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    setSheets(null);
    setError(null);
    setActive(0);
    void (async () => {
      try {
        const response = await fetch(url, { signal: controller.signal });
        if (!response.ok) throw new Error(t("文件下载失败（{status}）", { status: response.status }));
        const parsed = await parseXlsxForPreview(await response.arrayBuffer());
        setSheets(parsed);
      } catch (caught) {
        if (controller.signal.aborted) return;
        setError(caught instanceof Error ? caught.message : t("表格解析失败"));
      }
    })();
    return () => controller.abort();
  }, [url, t]);

  if (error) {
    return (
      <div className="mx-auto flex min-h-[52vh] max-w-lg flex-col items-center justify-center rounded-lg border border-dashed border-slate-300 bg-white px-8 text-center">
        <FileText className="h-10 w-10 text-muted-foreground" />
        <div className="mt-4 text-balance text-sm font-semibold text-[#1b2559]">{t("表格预览失败")}</div>
        <p className="mt-2 text-pretty text-xs leading-5 text-slate-500">{error}，{t("可点右上角“下载”打开。")}</p>
      </div>
    );
  }
  if (!sheets) {
    return (
      <div className="flex min-h-[52vh] flex-col items-center justify-center gap-3 text-slate-500">
        <Loader2 className="h-6 w-6 animate-spin motion-reduce:animate-none" />
        <span className="text-xs">{t("正在解析表格…")}</span>
      </div>
    );
  }
  if (sheets.length === 0 || sheets.every((sheet) => sheet.rowCount === 0)) {
    return (
      <div className="mx-auto flex min-h-[52vh] max-w-lg flex-col items-center justify-center rounded-lg border border-dashed border-slate-300 bg-white px-8 text-center">
        <Table2 className="h-10 w-10 text-muted-foreground" />
        <div className="mt-4 text-balance text-sm font-semibold text-[#1b2559]">{t("这张表是空的")}</div>
        <p className="mt-2 text-pretty text-xs leading-5 text-slate-500">{t("未读取到任何单元格内容。")}</p>
      </div>
    );
  }

  const sheet = sheets[Math.min(active, sheets.length - 1)];
  return (
    <div className="flex h-full min-h-[52vh] flex-col overflow-hidden rounded-lg border border-slate-200 bg-white">
      {sheets.length > 1 ? (
        <div className="flex shrink-0 items-center gap-1 overflow-x-auto border-b border-slate-200 bg-slate-50 px-2 py-1.5">
          {sheets.map((item, index) => (
            <Button variant="unstyled"
              key={`${item.name}-${index}`}
              type="button"
              onClick={() => setActive(index)}
              className={cn(
                "shrink-0 rounded-full px-2.5 py-1 text-xs font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30",
                index === active ? "bg-white text-primary shadow-sm" : "text-slate-500 hover:bg-white hover:text-slate-700",
              )}
            >
              {item.name}
            </Button>
          ))}
        </div>
      ) : null}
      <div className="min-h-0 flex-1 overflow-auto">
        <table className="border-collapse text-xs text-slate-800">
          <tbody>
            {sheet.rows.map((row, rowIndex) => (
              <tr key={rowIndex}>
                {row.map((cell, columnIndex) => cell === null ? null : (
                  <td
                    key={columnIndex}
                    rowSpan={cell.rowSpan}
                    colSpan={cell.colSpan}
                    className="min-w-[72px] max-w-[320px] whitespace-pre-wrap break-words border border-slate-200 px-2 py-1 align-top"
                  >
                    {cell.text}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
