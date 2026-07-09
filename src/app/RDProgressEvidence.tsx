import React, { useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronLeft, ChevronRight, Download, FileText, ImageIcon, Loader2, Paperclip, Table2, X } from "lucide-react";
import { cn } from "./components/ui/utils";
import { t } from "./lib/i18n";
import { getAttachmentPreviewUrl, getAttachmentThumbUrl, getAttachmentUrl, type RdTaskProgressAttachment, type RdTaskProgressNote } from "./lib/rdApi";
import { parseXlsxForPreview, type XlsxPreviewSheet } from "./lib/xlsxPreview";

/** 文件名/MIME 判断是否为 Excel 表格（xlsx/xls）。 */
function isSpreadsheetAttachment(att: { name?: string; mime?: string }): boolean {
  const ext = (att.name ?? "").split(".").pop()?.toLowerCase() ?? "";
  const mime = att.mime ?? "";
  return ext === "xlsx" || ext === "xls" || mime.includes("spreadsheetml") || mime.includes("ms-excel");
}

export function formatRdFileSize(size: number): string {
  if (!Number.isFinite(size) || size <= 0) return "0 B";
  if (size >= 1024 * 1024) return `${(size / 1024 / 1024).toFixed(1)} MB`;
  if (size >= 1024) return `${Math.ceil(size / 1024)} KB`;
  return `${size} B`;
}

// ── 任务图片聚合相册 ──────────────────────────────────────────────────────────

type GalleryImage = {
  att: RdTaskProgressAttachment;
  createdAt: string;
  date: string;
  actor: string;
};

/**
 * 任务图片聚合相册：把任务全部进度留痕里的图片拍平收拢到一处，按日期分组、
 * 每组横向滑动缩略条，点开全屏大图可左右切换——解决"上百张图散在各条留痕里翻不到"。
 * PC 任务详情与移动端共用；无图片时不渲染。
 */
export function TaskImageGallery({
  notes,
  defaultCollapsed = false,
  className,
}: {
  notes: RdTaskProgressNote[];
  defaultCollapsed?: boolean;
  className?: string;
}) {
  const images = useMemo<GalleryImage[]>(() => {
    const list: GalleryImage[] = [];
    for (const note of notes) {
      for (const att of note.attachments ?? []) {
        if ((att.mime ?? "").startsWith("image/")) {
          list.push({
            att,
            createdAt: note.created_at ?? "",
            date: (note.created_at ?? "").slice(0, 10) || "未知日期",
            actor: note.actor?.name ?? "",
          });
        }
      }
    }
    // 新 → 旧（最近的照片最先看到）
    return list.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }, [notes]);

  const groups = useMemo(() => {
    const byDate = new Map<string, GalleryImage[]>();
    for (const img of images) {
      const bucket = byDate.get(img.date);
      if (bucket) bucket.push(img);
      else byDate.set(img.date, [img]);
    }
    return Array.from(byDate.entries()).map(([date, items]) => ({ date, items }));
  }, [images]);

  const [collapsed, setCollapsed] = useState(defaultCollapsed);
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const indexOf = useMemo(() => {
    const m = new Map<string, number>();
    images.forEach((img, i) => m.set(img.att.id, i));
    return m;
  }, [images]);

  if (images.length === 0) return null;

  return (
    <div className={cn("rounded-xl border border-slate-100 bg-slate-50/60 px-3 py-2.5", className)}>
      <button
        type="button"
        onClick={() => setCollapsed((prev) => !prev)}
        className="flex w-full cursor-pointer items-center justify-between gap-2"
      >
        <span className="flex items-center gap-1.5 text-xs font-semibold text-slate-600">
          <ImageIcon className="h-3.5 w-3.5 text-blue-500" />
          {t("任务图片")}
          <span className="rounded-full bg-slate-200/80 px-1.5 py-0.5 text-[10px] font-semibold text-slate-500">{t("{n} 张", { n: images.length })}</span>
        </span>
        <ChevronDown className={cn("h-3.5 w-3.5 text-slate-400 transition-transform", collapsed && "-rotate-90")} />
      </button>

      {!collapsed && (
        <div className="mt-2 max-h-[300px] space-y-2.5 overflow-y-auto">
          {groups.map((group) => (
            <div key={group.date}>
              <div className="mb-1 text-[10px] font-semibold text-slate-400">
                {group.date} · {t("{n} 张", { n: group.items.length })}
              </div>
              {/* 横向滑动缩略条：图片多也不撑开布局，PC 滚轮/拖动、移动端触摸横滑 */}
              <div className="flex gap-1.5 overflow-x-auto pb-1 [scrollbar-width:thin]">
                {group.items.map((img) => (
                  <button
                    key={img.att.id}
                    type="button"
                    onClick={() => setLightboxIndex(indexOf.get(img.att.id) ?? 0)}
                    title={`${img.att.name}${img.actor ? ` · ${img.actor}` : ""}`}
                    className="h-[72px] w-[72px] shrink-0 cursor-pointer overflow-hidden rounded-lg border border-slate-200 bg-slate-100 transition hover:border-indigo-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300"
                  >
                    <img
                      src={getAttachmentThumbUrl(img.att)}
                      alt={img.att.name}
                      className="h-full w-full object-cover"
                      loading="lazy"
                      decoding="async"
                    />
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {lightboxIndex != null && images[lightboxIndex] && (
        <TaskImageLightbox
          images={images}
          index={lightboxIndex}
          onIndexChange={setLightboxIndex}
          onClose={() => setLightboxIndex(null)}
        />
      )}
    </div>
  );
}

/** 全屏大图预览：左右切换（按钮 + 键盘 ←→）、序号、文件信息、下载。 */
function TaskImageLightbox({
  images,
  index,
  onIndexChange,
  onClose,
}: {
  images: GalleryImage[];
  index: number;
  onIndexChange: (next: number) => void;
  onClose: () => void;
}) {
  const current = images[index];
  const hasPrev = index > 0;
  const hasNext = index < images.length - 1;

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
      if (event.key === "ArrowLeft" && hasPrev) onIndexChange(index - 1);
      if (event.key === "ArrowRight" && hasNext) onIndexChange(index + 1);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [index, hasPrev, hasNext, onIndexChange, onClose]);

  return (
    <div className="fixed inset-0 z-[90] flex flex-col bg-slate-950/85 backdrop-blur-sm" role="dialog" aria-modal="true">
      <div className="flex items-center justify-between gap-3 px-4 py-3 text-white">
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold">{current.att.name}</div>
          <div className="mt-0.5 text-xs text-white/60">
            {index + 1} / {images.length}
            {current.date !== "未知日期" ? ` · ${current.date}` : ""}
            {current.actor ? ` · ${current.actor}` : ""}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <a
            href={getAttachmentUrl(current.att)}
            download={current.att.name}
            target="_blank"
            rel="noopener noreferrer"
            className="flex h-9 w-9 items-center justify-center rounded-full bg-white/10 text-white/90 transition hover:bg-white/20"
            aria-label="下载原图"
          >
            <Download className="h-4 w-4" />
          </a>
          <button
            type="button"
            onClick={onClose}
            className="flex h-9 w-9 cursor-pointer items-center justify-center rounded-full bg-white/10 text-white/90 transition hover:bg-white/20"
            aria-label="关闭"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      <div className="relative flex min-h-0 flex-1 items-center justify-center px-14 pb-6">
        <button type="button" className="absolute inset-0 cursor-default" onClick={onClose} aria-label="关闭预览背景" />
        {hasPrev && (
          <button
            type="button"
            onClick={() => onIndexChange(index - 1)}
            className="absolute left-2 top-1/2 z-10 flex h-11 w-11 -translate-y-1/2 cursor-pointer items-center justify-center rounded-full bg-white/10 text-white transition hover:bg-white/25"
            aria-label="上一张"
          >
            <ChevronLeft className="h-6 w-6" />
          </button>
        )}
        <img
          src={getAttachmentUrl(current.att)}
          alt={current.att.name}
          className="relative max-h-full max-w-full rounded-lg object-contain shadow-2xl"
        />
        {hasNext && (
          <button
            type="button"
            onClick={() => onIndexChange(index + 1)}
            className="absolute right-2 top-1/2 z-10 flex h-11 w-11 -translate-y-1/2 cursor-pointer items-center justify-center rounded-full bg-white/10 text-white transition hover:bg-white/25"
            aria-label="下一张"
          >
            <ChevronRight className="h-6 w-6" />
          </button>
        )}
      </div>
    </div>
  );
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
                className="group block cursor-pointer overflow-hidden rounded-[8px] border border-slate-200 bg-slate-50 text-left transition hover:border-indigo-200 hover:shadow-[0_8px_18px_rgba(79,70,229,0.08)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300"
              >
                <div className={cn("relative bg-slate-100", compact ? "h-20" : "h-32")}>
                  <img
                    src={getAttachmentThumbUrl(att)}
                    alt={att.name}
                    className="h-full w-full object-cover transition-transform duration-200 group-hover:scale-[1.03]"
                    loading="lazy"
                    decoding="async"
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
  const isSpreadsheet = isSpreadsheetAttachment(attachment);
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
              href={getAttachmentUrl(attachment)}
              download={attachment.name}
              target="_blank"
              rel="noopener noreferrer"
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
              <img src={getAttachmentUrl(attachment)} alt={attachment.name} className="max-h-[72vh] max-w-full rounded-[8px] bg-white object-contain shadow-sm" />
            </div>
          ) : isSpreadsheet ? (
            <XlsxTablePreview attachment={attachment} />
          ) : canInlinePreview ? (
            <iframe
              src={getAttachmentPreviewUrl(attachment)}
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

/** Excel 附件的只读 HTML 表格预览：拉取文件 → exceljs 解析 → 渲染表格（支持多 sheet 切页、合并单元格）。 */
function XlsxTablePreview({ attachment }: { attachment: RdTaskProgressAttachment }) {
  const [sheets, setSheets] = useState<XlsxPreviewSheet[] | null>(null);
  const [active, setActive] = useState(0);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setSheets(null);
    setError(null);
    setActive(0);
    (async () => {
      try {
        const res = await fetch(getAttachmentPreviewUrl(attachment));
        if (!res.ok) throw new Error(`文件下载失败（${res.status}）`);
        const buf = await res.arrayBuffer();
        const parsed = await parseXlsxForPreview(buf);
        if (!cancelled) setSheets(parsed);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "表格解析失败");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [attachment]);

  if (error) {
    return (
      <div className="mx-auto flex min-h-[52vh] max-w-lg flex-col items-center justify-center rounded-[8px] border border-dashed border-slate-300 bg-white px-8 text-center">
        <FileText className="h-10 w-10 text-slate-300" />
        <div className="mt-4 text-sm font-semibold text-slate-900">表格预览失败</div>
        <p className="mt-2 text-xs leading-5 text-slate-500">{error}，可点右上角「下载」打开。</p>
      </div>
    );
  }
  if (!sheets) {
    return (
      <div className="flex min-h-[52vh] flex-col items-center justify-center gap-3 text-slate-500">
        <Loader2 className="h-6 w-6 animate-spin motion-reduce:animate-none" />
        <span className="text-xs">正在解析表格…</span>
      </div>
    );
  }
  if (sheets.length === 0 || sheets.every((s) => s.rowCount === 0)) {
    return (
      <div className="mx-auto flex min-h-[52vh] max-w-lg flex-col items-center justify-center rounded-[8px] border border-dashed border-slate-300 bg-white px-8 text-center">
        <Table2 className="h-10 w-10 text-slate-300" />
        <div className="mt-4 text-sm font-semibold text-slate-900">这张表是空的</div>
        <p className="mt-2 text-xs leading-5 text-slate-500">未读取到任何单元格内容。</p>
      </div>
    );
  }

  const sheet = sheets[Math.min(active, sheets.length - 1)];
  return (
    <div className="flex h-full min-h-[52vh] flex-col overflow-hidden rounded-[8px] border border-slate-200 bg-white">
      {sheets.length > 1 && (
        <div className="flex shrink-0 items-center gap-1 overflow-x-auto border-b border-slate-200 bg-slate-50 px-2 py-1.5">
          {sheets.map((s, i) => (
            <button
              key={i}
              type="button"
              onClick={() => setActive(i)}
              className={cn(
                "shrink-0 rounded-[6px] px-2.5 py-1 text-xs font-medium transition",
                i === active ? "bg-white text-blue-700 shadow-sm" : "text-slate-500 hover:bg-white/70 hover:text-slate-700",
              )}
            >
              {s.name}
            </button>
          ))}
        </div>
      )}
      <div className="min-h-0 flex-1 overflow-auto">
        <table className="border-collapse text-xs text-slate-800">
          <tbody>
            {sheet.rows.map((row, r) => (
              <tr key={r}>
                {row.map((cell, c) =>
                  cell === null ? null : (
                    <td
                      key={c}
                      rowSpan={cell.rowSpan}
                      colSpan={cell.colSpan}
                      className="min-w-[72px] max-w-[320px] whitespace-pre-wrap break-words border border-slate-200 px-2 py-1 align-top"
                    >
                      {cell.text}
                    </td>
                  ),
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function ProgressNoteList({
  notes,
  loading = false,
  emptyText,
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
        {t("正在读取进度留痕...")}
      </div>
    );
  }

  if (notes.length === 0) {
    return (
      <div className="rounded-[8px] border border-dashed border-slate-200 bg-slate-50/70 px-3 py-4 text-center text-xs text-slate-400">
        {emptyText ?? t("暂无进度记录")}
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
              {note.actor.role ? <span className="ml-1 text-slate-400">· {t(note.actor.role)}</span> : null}
            </span>
            <span className="shrink-0 tabular-nums">{new Date(note.created_at).toLocaleString("zh-CN")}</span>
          </div>
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            {typeof note.progress === "number" && (
              <span className="inline-flex items-center gap-1 rounded-full bg-blue-50 px-2 py-0.5 text-[10px] font-semibold text-blue-700">
                {t("进度更新至 {n}%", { n: note.progress })}
              </span>
            )}
            {note.attachments.length > 0 && (
              <span className="inline-flex items-center gap-1 rounded-full bg-violet-50 px-2 py-0.5 text-[10px] font-semibold text-violet-700">
                <Paperclip className="h-3 w-3" />
                {t("{n} 个附件", { n: note.attachments.length })}
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
