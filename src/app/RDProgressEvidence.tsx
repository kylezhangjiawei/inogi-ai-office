import React, { useEffect, useState } from "react";
import { Download, FileText, ImageIcon, Paperclip, X } from "lucide-react";
import { cn } from "./components/ui/utils";
import type { RdTaskProgressAttachment, RdTaskProgressNote } from "./lib/rdApi";

export function formatRdFileSize(size: number): string {
  if (!Number.isFinite(size) || size <= 0) return "0 B";
  if (size >= 1024 * 1024) return `${(size / 1024 / 1024).toFixed(1)} MB`;
  if (size >= 1024) return `${Math.ceil(size / 1024)} KB`;
  return `${size} B`;
}

export function ProgressAttachmentGrid({
  attachments,
  compact = false,
  className,
}: {
  attachments: RdTaskProgressAttachment[];
  compact?: boolean;
  className?: string;
}) {
  const [preview, setPreview] = useState<RdTaskProgressAttachment | null>(null);

  useEffect(() => {
    if (!preview) return undefined;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setPreview(null);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [preview]);

  if (!attachments.length) return null;

  return (
    <>
      <div className={cn("grid gap-2", compact ? "grid-cols-1 sm:grid-cols-2" : "sm:grid-cols-2", className)}>
        {attachments.map((att) => {
          const isImage = att.mime.startsWith("image/");
          if (isImage) {
            return (
              <button
                key={att.id}
                type="button"
                onClick={() => setPreview(att)}
                title={`${att.name} · ${formatRdFileSize(att.size)}`}
                className="group block cursor-pointer overflow-hidden rounded-[8px] border border-slate-200 bg-slate-50 text-left transition hover:border-blue-200 hover:shadow-[0_8px_18px_rgba(37,99,235,0.08)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-300"
              >
                <div className={cn("relative bg-slate-100", compact ? "h-20" : "h-32")}>
                  <img
                    src={att.data_url}
                    alt={att.name}
                    className="h-full w-full object-cover transition-transform duration-200 group-hover:scale-[1.03]"
                    loading="lazy"
                  />
                  <span className="absolute left-2 top-2 inline-flex items-center gap-1 rounded-md bg-white/90 px-1.5 py-0.5 text-[10px] font-semibold text-slate-600 shadow-sm">
                    <ImageIcon className="h-3 w-3 text-blue-500" />
                    图片
                  </span>
                </div>
                <div className="flex items-center justify-between gap-2 px-2 py-1.5">
                  <span className="min-w-0 truncate text-[11px] font-medium text-slate-700">{att.name}</span>
                  <span className="shrink-0 text-[10px] text-slate-400">{formatRdFileSize(att.size)}</span>
                </div>
              </button>
            );
          }

          return (
            <button
              key={att.id}
              type="button"
              onClick={() => setPreview(att)}
              title={`${att.name} · ${formatRdFileSize(att.size)}`}
              className="flex min-w-0 cursor-pointer items-center gap-2 rounded-[8px] border border-slate-200 bg-slate-50 px-2.5 py-2 text-left text-xs text-slate-700 transition hover:border-blue-200 hover:bg-blue-50/60 hover:text-blue-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-300"
            >
              <FileText className="h-3.5 w-3.5 shrink-0 text-slate-400" />
              <span className="min-w-0 flex-1 truncate">{att.name}</span>
              <span className="shrink-0 text-[10px] text-slate-400">{formatRdFileSize(att.size)}</span>
            </button>
          );
        })}
      </div>
      {preview && <AttachmentPreviewModal attachment={preview} onClose={() => setPreview(null)} />}
    </>
  );
}

function AttachmentPreviewModal({
  attachment,
  onClose,
}: {
  attachment: RdTaskProgressAttachment;
  onClose: () => void;
}) {
  const isImage = attachment.mime.startsWith("image/");
  const canInlinePreview =
    isImage ||
    attachment.mime === "application/pdf" ||
    attachment.mime.startsWith("text/") ||
    attachment.mime.includes("json");

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-950/72 px-4 py-6 backdrop-blur-sm" role="dialog" aria-modal="true">
      <button type="button" className="absolute inset-0 cursor-default" onClick={onClose} aria-label="关闭预览背景" />
      <div className="relative flex max-h-[88vh] w-full max-w-5xl flex-col overflow-hidden rounded-[8px] border border-white/10 bg-white shadow-2xl">
        <div className="flex items-center justify-between gap-3 border-b border-slate-200 px-4 py-3">
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold text-slate-900">{attachment.name}</div>
            <div className="mt-0.5 text-xs text-slate-500">
              {attachment.mime || "未知类型"} · {formatRdFileSize(attachment.size)}
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <a
              href={attachment.data_url}
              download={attachment.name}
              className="inline-flex h-8 items-center gap-1.5 rounded-[8px] border border-slate-200 bg-white px-2.5 text-xs font-semibold text-slate-700 transition hover:border-blue-200 hover:bg-blue-50 hover:text-blue-700"
            >
              <Download className="h-3.5 w-3.5" />
              下载
            </a>
            <button
              type="button"
              onClick={onClose}
              className="flex h-8 w-8 cursor-pointer items-center justify-center rounded-[8px] border border-slate-200 text-slate-500 transition hover:bg-slate-50 hover:text-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-300"
              aria-label="关闭预览"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-auto bg-slate-100 p-4">
          {isImage ? (
            <div className="flex min-h-[52vh] items-center justify-center">
              <img src={attachment.data_url} alt={attachment.name} className="max-h-[72vh] max-w-full rounded-[8px] bg-white object-contain shadow-sm" />
            </div>
          ) : canInlinePreview ? (
            <iframe
              src={attachment.data_url}
              title={attachment.name}
              className="h-[72vh] w-full rounded-[8px] border border-slate-200 bg-white"
            />
          ) : (
            <div className="mx-auto flex min-h-[52vh] max-w-lg flex-col items-center justify-center rounded-[8px] border border-dashed border-slate-300 bg-white px-8 text-center">
              <FileText className="h-10 w-10 text-slate-300" />
              <div className="mt-4 text-sm font-semibold text-slate-900">当前格式暂不支持内嵌预览</div>
              <p className="mt-2 text-xs leading-5 text-slate-500">
                文件已保留在当前留痕记录中，可直接下载查看，不会离开当前驾驶舱页面。
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export function ProgressNoteList({
  notes,
  loading = false,
  emptyText = "暂无进度记录",
  compact = false,
}: {
  notes: RdTaskProgressNote[];
  loading?: boolean;
  emptyText?: string;
  compact?: boolean;
}) {
  if (loading) {
    return (
      <div className="rounded-[8px] border border-dashed border-slate-200 bg-slate-50/70 px-3 py-4 text-center text-xs text-slate-400">
        正在读取进度留痕...
      </div>
    );
  }

  if (notes.length === 0) {
    return (
      <div className="rounded-[8px] border border-dashed border-slate-200 bg-slate-50/70 px-3 py-4 text-center text-xs text-slate-400">
        {emptyText}
      </div>
    );
  }

  return (
    <ul className="space-y-3">
      {notes.map((note) => (
        <li key={note.id} className="rounded-[8px] border border-slate-200 bg-white p-3">
          <div className="flex items-start justify-between gap-2 text-[11px] text-slate-500">
            <span className="min-w-0 font-medium text-slate-700">
              {note.actor.name}
              {note.actor.role ? <span className="ml-1 text-slate-400">· {note.actor.role}</span> : null}
            </span>
            <span className="shrink-0 tabular-nums">{new Date(note.created_at).toLocaleString("zh-CN")}</span>
          </div>
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            {typeof note.progress === "number" && (
              <span className="inline-flex items-center gap-1 rounded-full bg-blue-50 px-2 py-0.5 text-[10px] font-semibold text-blue-700">
                进度更新至 {note.progress}%
              </span>
            )}
            {note.attachments.length > 0 && (
              <span className="inline-flex items-center gap-1 rounded-full bg-violet-50 px-2 py-0.5 text-[10px] font-semibold text-violet-700">
                <Paperclip className="h-3 w-3" />
                {note.attachments.length} 个附件
              </span>
            )}
          </div>
          {note.text && (
            <p className={cn("mt-2 whitespace-pre-wrap text-slate-800", compact ? "text-xs leading-5" : "text-sm leading-relaxed")}>
              {note.text}
            </p>
          )}
          <ProgressAttachmentGrid attachments={note.attachments} compact={compact} className="mt-3" />
        </li>
      ))}
    </ul>
  );
}
