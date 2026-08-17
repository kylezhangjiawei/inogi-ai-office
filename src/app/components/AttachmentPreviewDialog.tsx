import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Download, FileText, Loader2, Table2, X } from "lucide-react";

import { useBodyScrollLock } from "../hooks/useMobileOverlay";
import { useI18n } from "../lib/i18n";
import { parseXlsxForPreview, type XlsxPreviewSheet } from "../lib/xlsxPreview";
import { MobileZoomableImage } from "./MobileZoomableImage";
import { cn } from "./ui/utils";

export type PreviewableAttachment = {
  id?: string;
  name: string;
  mime?: string;
  size?: number;
  url: string;
  previewUrl?: string;
  downloadUrl?: string;
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

function attachmentMime(attachment: PreviewableAttachment): string {
  const declared = attachment.mime?.trim().toLowerCase();
  if (declared && declared !== "application/octet-stream") return declared;
  const extension = attachment.name.split(".").pop()?.toLowerCase() ?? "";
  return MIME_BY_EXTENSION[extension] ?? declared ?? "application/octet-stream";
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
  onClose,
}: {
  attachment: PreviewableAttachment;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const mime = attachmentMime(attachment);
  const previewUrl = attachment.previewUrl || attachment.url;
  const downloadUrl = attachment.downloadUrl || attachment.url;
  const isImage = mime.startsWith("image/");
  const isVideo = mime.startsWith("video/");
  const isAudio = mime.startsWith("audio/");
  const isSpreadsheet = isSpreadsheetAttachment(attachment, mime);
  const canInlinePreview = mime === "application/pdf" || mime === "text/plain" || mime === "application/json";
  useBodyScrollLock(true);

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [onClose]);

  return createPortal(
    <div
      className="fixed inset-0 z-[1100] flex items-center justify-center overscroll-none bg-slate-950/72 px-4 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-[max(1.5rem,env(safe-area-inset-top))] backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label={t("附件预览：{name}", { name: attachment.name })}
      onClick={(event) => {
        if (!isMobileRoute() && event.target === event.currentTarget) onClose();
      }}
    >
      <div className="relative flex max-h-[88dvh] w-full max-w-5xl flex-col overflow-hidden rounded-lg border border-white/10 bg-white shadow-2xl">
        <div className="flex items-center justify-between gap-3 border-b border-slate-200 px-4 py-3">
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold text-slate-900">{attachment.name}</div>
            <div className="mt-0.5 text-xs text-slate-500">{mime} · {formatFileSize(attachment.size)}</div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <a
              href={downloadUrl}
              download={attachment.name}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 text-xs font-semibold text-slate-700 transition hover:border-indigo-200 hover:bg-indigo-50 hover:text-indigo-700"
            >
              <Download className="h-3.5 w-3.5" />
              {t("下载")}
            </a>
            <button
              type="button"
              onClick={onClose}
              className="flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg border border-slate-200 text-slate-500 transition hover:bg-slate-50 hover:text-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300"
              aria-label={t("关闭预览")}
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-auto bg-slate-100 p-4">
          {isImage ? (
            <div className="flex min-h-[52vh] items-center justify-center">
              <MobileZoomableImage
                src={previewUrl}
                alt={attachment.name}
                loading="eager"
                decoding="async"
                enabled
                stopPropagation={false}
                className="h-[72vh] max-h-[72vh] w-full overflow-hidden rounded-lg bg-white shadow-sm"
                imageClassName="h-full w-full object-contain"
              />
            </div>
          ) : isVideo ? (
            <div className="flex min-h-[52vh] items-center justify-center">
              <video src={previewUrl} controls autoPlay playsInline className="max-h-[72vh] max-w-full rounded-lg bg-slate-950 shadow-sm">
                {t("当前浏览器暂不支持视频播放")}
              </video>
            </div>
          ) : isAudio ? (
            <div className="flex min-h-[52vh] items-center justify-center">
              <audio src={previewUrl} controls autoPlay className="w-full max-w-xl" />
            </div>
          ) : isSpreadsheet ? (
            <XlsxTablePreview url={previewUrl} />
          ) : canInlinePreview ? (
            <iframe
              src={previewUrl}
              title={attachment.name}
              sandbox=""
              referrerPolicy="no-referrer"
              className="h-[72vh] w-full rounded-lg border border-slate-200 bg-white"
            />
          ) : (
            <UnsupportedPreview />
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}

function UnsupportedPreview() {
  const { t } = useI18n();
  return (
    <div className="mx-auto flex min-h-[52vh] max-w-lg flex-col items-center justify-center rounded-lg border border-dashed border-slate-300 bg-white px-8 text-center">
      <FileText className="h-10 w-10 text-slate-300" />
      <div className="mt-4 text-sm font-semibold text-slate-900">{t("当前格式暂不支持内嵌预览")}</div>
      <p className="mt-2 text-xs leading-5 text-slate-500">{t("文件已保留在当前任务中，可直接下载查看，不会离开采购驾驶舱页面。")}</p>
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
        <FileText className="h-10 w-10 text-slate-300" />
        <div className="mt-4 text-sm font-semibold text-slate-900">{t("表格预览失败")}</div>
        <p className="mt-2 text-xs leading-5 text-slate-500">{error}，{t("可点右上角“下载”打开。")}</p>
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
        <Table2 className="h-10 w-10 text-slate-300" />
        <div className="mt-4 text-sm font-semibold text-slate-900">{t("这张表是空的")}</div>
        <p className="mt-2 text-xs leading-5 text-slate-500">{t("未读取到任何单元格内容。")}</p>
      </div>
    );
  }

  const sheet = sheets[Math.min(active, sheets.length - 1)];
  return (
    <div className="flex h-full min-h-[52vh] flex-col overflow-hidden rounded-lg border border-slate-200 bg-white">
      {sheets.length > 1 ? (
        <div className="flex shrink-0 items-center gap-1 overflow-x-auto border-b border-slate-200 bg-slate-50 px-2 py-1.5">
          {sheets.map((item, index) => (
            <button
              key={`${item.name}-${index}`}
              type="button"
              onClick={() => setActive(index)}
              className={cn(
                "shrink-0 rounded-md px-2.5 py-1 text-xs font-medium transition",
                index === active ? "bg-white text-indigo-700 shadow-sm" : "text-slate-500 hover:bg-white/70 hover:text-slate-700",
              )}
            >
              {item.name}
            </button>
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
