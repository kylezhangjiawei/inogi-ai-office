import React, { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronDown, ChevronLeft, ChevronRight, Download, FileText, ImageIcon, Loader2, Paperclip, PlayCircle, RefreshCw, Table2, Trash2, Video, X } from "lucide-react";
import { cn } from "./components/ui/utils";
import { currentI18nLang, i18nLocale, t, useI18n } from "./lib/i18n";
import { renderTextWithMentions } from "./components/MentionInput";
import { AutoTranslatedText } from "./components/TranslatableText";
import { getAttachmentDownloadUrl, getAttachmentPreviewUrl, getAttachmentThumbUrl, getAttachmentUrl, type RdTaskProgressAttachment, type RdTaskProgressNote } from "./lib/rdApi";
import { parseXlsxForPreview, type XlsxPreviewSheet } from "./lib/xlsxPreview";
import {
  closeMobileOverlay,
  pushMobileOverlayState,
  useBodyScrollLock,
  useMobileOverlayBack,
} from "./hooks/useMobileOverlay";

const TASK_GALLERY_OVERLAY = "rd-task-image-gallery";
const ATTACHMENT_PREVIEW_OVERLAY = "rd-attachment-preview";
const MOBILE_ATTACHMENT_PREVIEW_EVENT = "rd:open-mobile-attachment-preview";

function isMobileRoute(): boolean {
  return document.documentElement.classList.contains("mobile-route");
}

/**
 * iOS/Android WebView may deliver a delayed compatibility click after the
 * thumbnail tap. By then the full-screen backdrop is under the finger and the
 * click would immediately close the preview. Mobile previews therefore close
 * only through the explicit close button or the system Back action.
 */
function shouldCloseFromBackdrop(event: React.MouseEvent<HTMLElement>): boolean {
  return !isMobileRoute() && event.target === event.currentTarget;
}

/**
 * 留痕时间的统一格式化：完整日期 + 时分秒，按浏览器本地时区。
 * 全站「留痕」相关的时间展示（进展留痕、附件上传、子任务并入）都走这里，避免各处
 * 各写一套导致粒度不一。
 * ⚠️ 不要用 iso.slice(0,16) 之类的字符串截断——那截出来的是 UTC，会比本地时间少 8 小时。
 */
export function formatTraceDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString(i18nLocale(), {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

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

  useI18n(); // 共享组件自行订阅语言切换
  const [collapsed, setCollapsed] = useState(defaultCollapsed);
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const dismissLightbox = useCallback(() => setLightboxIndex(null), []);
  useMobileOverlayBack(lightboxIndex != null, TASK_GALLERY_OVERLAY, dismissLightbox);
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
                    onClick={() => {
                      pushMobileOverlayState(TASK_GALLERY_OVERLAY);
                      setLightboxIndex(indexOf.get(img.att.id) ?? 0);
                    }}
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
          onClose={() => closeMobileOverlay(TASK_GALLERY_OVERLAY, dismissLightbox)}
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
  useBodyScrollLock(true);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
      if (event.key === "ArrowLeft" && hasPrev) onIndexChange(index - 1);
      if (event.key === "ArrowRight" && hasNext) onIndexChange(index + 1);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [index, hasPrev, hasNext, onIndexChange, onClose]);

  return createPortal(
    <div className="fixed inset-0 z-[1000] flex flex-col overscroll-none bg-slate-950/85 backdrop-blur-sm" role="dialog" aria-modal="true" aria-label={`图片预览：${current.att.name}`}>
      <div className="flex items-center justify-between gap-3 px-4 pb-3 pt-[max(0.75rem,env(safe-area-inset-top))] text-white">
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
            href={getAttachmentDownloadUrl(current.att)}
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

      <div
        className="relative flex min-h-0 flex-1 items-center justify-center px-14 pb-[max(1.5rem,env(safe-area-inset-bottom))]"
        onClick={(event) => {
          if (shouldCloseFromBackdrop(event)) onClose();
        }}
      >
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
          loading="eager"
          decoding="async"
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
    </div>,
    document.body,
  );
}

export function ProgressAttachmentGrid({
  attachments,
  compact = false,
  className,
  onDeleteAttachment,
  onReplaceAttachment,
}: {
  attachments: RdTaskProgressAttachment[];
  compact?: boolean;
  className?: string;
  /** 可选：附件管理回调（工作台传入）。不传时纯展示，其他页面行为不变。 */
  onDeleteAttachment?: (att: RdTaskProgressAttachment) => void;
  onReplaceAttachment?: (att: RdTaskProgressAttachment) => void;
}) {
  const [preview, setPreview] = useState<RdTaskProgressAttachment | null>(null);
  const dismissPreview = useCallback(() => setPreview(null), []);
  useMobileOverlayBack(Boolean(preview), ATTACHMENT_PREVIEW_OVERLAY, dismissPreview);
  const managed = Boolean(onDeleteAttachment || onReplaceAttachment);

  const openPreview = (attachment: RdTaskProgressAttachment) => {
    if (isMobileRoute()) {
      const event = new CustomEvent<RdTaskProgressAttachment>(MOBILE_ATTACHMENT_PREVIEW_EVENT, {
        detail: attachment,
        cancelable: true,
      });
      // The mobile page-level host owns the preview so polling or rebuilding a
      // message card cannot unmount it. Fall back to local state on pages that
      // do not mount the host.
      if (!window.dispatchEvent(event)) return;
    }
    pushMobileOverlayState(ATTACHMENT_PREVIEW_OVERLAY);
    setPreview(attachment);
  };
  const closePreview = useCallback(
    () => closeMobileOverlay(ATTACHMENT_PREVIEW_OVERLAY, dismissPreview),
    [dismissPreview],
  );

  useEffect(() => {
    if (!preview) return undefined;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") closePreview();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [closePreview, preview]);

  if (!attachments.length) return null;

  // 悬停/聚焦角标工具条（替换/删除）：与展示按钮平级绝对定位，避免 button 嵌套。
  // group-focus-within 保证键盘可达：Tab 聚焦到格子的主按钮即显示工具条，继续 Tab 可触达角标。
  const renderActions = (att: RdTaskProgressAttachment) =>
    managed ? (
      <span className="absolute right-1.5 top-1.5 z-10 hidden items-center gap-1 group-hover/att:flex group-focus-within/att:flex">
        {onReplaceAttachment && (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onReplaceAttachment(att); }}
            title={t("替换附件")}
            aria-label={t("替换附件")}
            className="flex h-6 w-6 cursor-pointer items-center justify-center rounded-md bg-white/95 text-slate-500 shadow-sm ring-1 ring-slate-200 transition-colors hover:bg-amber-50 hover:text-amber-600"
          >
            <RefreshCw className="h-3 w-3" />
          </button>
        )}
        {onDeleteAttachment && (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onDeleteAttachment(att); }}
            title={t("删除附件")}
            aria-label={t("删除附件")}
            className="flex h-6 w-6 cursor-pointer items-center justify-center rounded-md bg-white/95 text-slate-500 shadow-sm ring-1 ring-slate-200 transition-colors hover:bg-red-50 hover:text-red-600"
          >
            <Trash2 className="h-3 w-3" />
          </button>
        )}
      </span>
    ) : null;

  return (
    <>
      <div className={cn(
        "grid",
        compact ? "grid-cols-[repeat(auto-fit,minmax(140px,1fr))] gap-1" : "gap-2 sm:grid-cols-2",
        className,
      )}>
        {attachments.map((att) => {
          const isImage = att.mime.startsWith("image/");
          const isVideo = att.mime.startsWith("video/");
          if (isImage) {
            return (
              <div key={att.id} className="group/att relative">
                {renderActions(att)}
                <button
                  type="button"
                  onClick={() => openPreview(att)}
                  title={`${att.name} · ${formatRdFileSize(att.size)}`}
                  className="group block w-full cursor-pointer overflow-hidden rounded-[8px] border border-slate-200 bg-slate-50 text-left transition hover:border-indigo-200 hover:shadow-[0_8px_18px_rgba(79,70,229,0.08)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300"
                >
                  <div className={cn("relative bg-slate-100", compact ? "h-12" : "h-32")}>
                    <img
                      src={getAttachmentThumbUrl(att)}
                      alt={att.name}
                      className="h-full w-full object-cover transition-transform duration-200 group-hover:scale-[1.03]"
                      loading="lazy"
                      decoding="async"
                    />
                    <span className={cn(
                      "absolute inline-flex items-center gap-1 rounded bg-white/90 px-1.5 py-0.5 text-[9px] font-semibold text-slate-600 shadow-sm",
                      compact ? "left-1 top-1" : "left-2 top-2",
                    )}>
                      <ImageIcon className="h-3 w-3 text-blue-500" />
                      图片
                    </span>
                  </div>
                  <div className={cn("flex items-center justify-between gap-2", compact ? "px-1.5 py-1" : "px-2 py-1.5")}>
                    <span className={cn("min-w-0 truncate font-medium text-slate-700", compact ? "text-[10px]" : "text-[11px]")}>{att.name}</span>
                    <span className="shrink-0 text-[9px] text-slate-400">{formatRdFileSize(att.size)}</span>
                  </div>
                </button>
              </div>
            );
          }

          if (isVideo) {
            return (
              <div key={att.id} className="group/att relative">
                {renderActions(att)}
                <button
                  type="button"
                  onClick={() => openPreview(att)}
                  title={`${att.name} · ${formatRdFileSize(att.size)}`}
                  className="group block w-full cursor-pointer overflow-hidden rounded-[8px] border border-slate-200 bg-slate-950 text-left transition hover:border-indigo-300 hover:shadow-[0_8px_18px_rgba(79,70,229,0.12)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300"
                >
                  <div className={cn("relative overflow-hidden bg-slate-900", compact ? "h-12" : "h-32")}>
                    <video
                      src={getAttachmentUrl(att)}
                      className="h-full w-full object-cover opacity-80"
                      preload="metadata"
                      muted
                      playsInline
                      aria-label={att.name}
                    />
                    <span className="absolute inset-0 flex items-center justify-center">
                      <span className="flex h-9 w-9 items-center justify-center rounded-full bg-white/90 text-indigo-600 shadow-lg transition-transform duration-200 group-hover:scale-105">
                        <PlayCircle className="h-5 w-5" />
                      </span>
                    </span>
                    <span className={cn(
                      "absolute inline-flex items-center gap-1 rounded bg-slate-950/72 px-1.5 py-0.5 text-[9px] font-semibold text-white shadow-sm",
                      compact ? "left-1 top-1" : "left-2 top-2",
                    )}>
                      <Video className="h-3 w-3" />
                      {t("视频")}
                    </span>
                  </div>
                  <div className={cn("flex items-center justify-between gap-2 bg-white", compact ? "px-1.5 py-1" : "px-2 py-1.5")}>
                    <span className={cn("min-w-0 truncate font-medium text-slate-700", compact ? "text-[10px]" : "text-[11px]")}>{att.name}</span>
                    <span className="shrink-0 text-[9px] text-slate-400">{formatRdFileSize(att.size)}</span>
                  </div>
                </button>
              </div>
            );
          }

          return (
            <div key={att.id} className="group/att relative">
              {renderActions(att)}
              <button
                type="button"
                onClick={() => openPreview(att)}
                title={`${att.name} · ${formatRdFileSize(att.size)}`}
                className={cn(
                  "flex w-full min-w-0 cursor-pointer items-center gap-2 rounded-[8px] border border-slate-200 bg-slate-50 px-2.5 text-left text-xs text-slate-700 transition hover:border-blue-200 hover:bg-blue-50/60 hover:text-blue-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-300",
                  compact ? "py-1.5" : "py-2",
                )}
              >
                <FileText className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                <span className="min-w-0 flex-1 truncate">{att.name}</span>
                <span className="shrink-0 text-[10px] text-slate-400">{formatRdFileSize(att.size)}</span>
              </button>
            </div>
          );
        })}
      </div>
      {preview && <AttachmentPreviewModal attachment={preview} onClose={closePreview} />}
    </>
  );
}

/**
 * Mobile-only persistent preview owner. It is mounted above the conversation
 * cards so background refreshes, thread hydration and list reconciliation do
 * not destroy an already-open attachment preview.
 */
export function MobileAttachmentPreviewHost() {
  const [preview, setPreview] = useState<RdTaskProgressAttachment | null>(null);
  const dismissPreview = useCallback(() => setPreview(null), []);
  const closePreview = useCallback(
    () => closeMobileOverlay(ATTACHMENT_PREVIEW_OVERLAY, dismissPreview),
    [dismissPreview],
  );

  useMobileOverlayBack(Boolean(preview), ATTACHMENT_PREVIEW_OVERLAY, dismissPreview);

  useEffect(() => {
    const handleOpen = (event: Event) => {
      const attachment = (event as CustomEvent<RdTaskProgressAttachment>).detail;
      if (!attachment) return;
      event.preventDefault();
      pushMobileOverlayState(ATTACHMENT_PREVIEW_OVERLAY);
      setPreview(attachment);
    };
    window.addEventListener(MOBILE_ATTACHMENT_PREVIEW_EVENT, handleOpen);
    return () => window.removeEventListener(MOBILE_ATTACHMENT_PREVIEW_EVENT, handleOpen);
  }, []);

  useEffect(() => {
    if (!preview) return undefined;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") closePreview();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [closePreview, preview]);

  return preview ? <AttachmentPreviewModal attachment={preview} onClose={closePreview} /> : null;
}

function AttachmentPreviewModal({
  attachment,
  onClose,
}: {
  attachment: RdTaskProgressAttachment;
  onClose: () => void;
}) {
  const isImage = attachment.mime.startsWith("image/");
  const isVideo = attachment.mime.startsWith("video/");
  const isSpreadsheet = isSpreadsheetAttachment(attachment);
  const canInlinePreview =
    isImage ||
    isVideo ||
    attachment.mime === "application/pdf" ||
    attachment.mime === "text/plain" ||
    attachment.mime === "application/json";
  useBodyScrollLock(true);

  return createPortal(
    <div
      className="fixed inset-0 z-[1000] flex items-center justify-center overscroll-none bg-slate-950/72 px-4 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-[max(1.5rem,env(safe-area-inset-top))] backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label={`附件预览：${attachment.name}`}
      onClick={(event) => {
        if (shouldCloseFromBackdrop(event)) onClose();
      }}
    >
      <div className="relative flex max-h-[88dvh] w-full max-w-5xl flex-col overflow-hidden rounded-[8px] border border-white/10 bg-white shadow-2xl">
        <div className="flex items-center justify-between gap-3 border-b border-slate-200 px-4 py-3">
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold text-slate-900">{attachment.name}</div>
            <div className="mt-0.5 text-xs text-slate-500">
              {attachment.mime || "未知类型"} · {formatRdFileSize(attachment.size)}
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <a
              href={getAttachmentDownloadUrl(attachment)}
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
              <img
                src={getAttachmentUrl(attachment)}
                alt={attachment.name}
                loading="eager"
                decoding="async"
                className="max-h-[72vh] max-w-full rounded-[8px] bg-white object-contain shadow-sm"
              />
            </div>
          ) : isVideo ? (
            <div className="flex min-h-[52vh] items-center justify-center">
              <video
                src={getAttachmentUrl(attachment)}
                controls
                autoPlay
                playsInline
                className="max-h-[72vh] max-w-full rounded-[8px] bg-slate-950 shadow-sm"
              >
                {t("当前浏览器暂不支持视频播放")}
              </video>
            </div>
          ) : isSpreadsheet ? (
            <XlsxTablePreview attachment={attachment} />
          ) : canInlinePreview ? (
            <iframe
              src={getAttachmentPreviewUrl(attachment)}
              title={attachment.name}
              sandbox=""
              referrerPolicy="no-referrer"
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
    </div>,
    document.body,
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
  renderSource,
}: {
  notes: RdTaskProgressNote[];
  loading?: boolean;
  emptyText?: string;
  compact?: boolean;
  /**
   * 每条留痕的来源标记（聚合视图用）：父任务详情的「主线」把自身与各子任务的留痕
   * 混在一条时间线里，靠这个插槽标出每条属于哪个任务。不传则不显示（单任务视图原样）。
   */
  renderSource?: (note: RdTaskProgressNote) => React.ReactNode;
}) {
  useI18n(); // 共享组件自行订阅语言切换（不依赖父级是否订阅）
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
            <span className="flex min-w-0 flex-wrap items-center gap-1.5 font-medium text-slate-700">
              {renderSource?.(note)}
              <span className="min-w-0">
                {note.actor.name}
                {note.actor.role ? <span className="ml-1 text-slate-400">· {t(note.actor.role)}</span> : null}
              </span>
            </span>
            <span className="shrink-0 whitespace-nowrap tabular-nums">{formatTraceDateTime(note.created_at)}</span>
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
            // 含 @ 提及的评论在中文态用高亮渲染（@姓名 蓝色）；英文态人名不参与翻译、
            // 高亮与整段自动翻译不可兼得，保持 AutoTranslatedText 原行为
            (note.mentions?.length ?? 0) > 0 && currentI18nLang() === "zh" ? (
              <p className={cn("mt-2 whitespace-pre-wrap text-slate-800", compact ? "text-xs leading-5" : "text-sm leading-relaxed")}>
                {renderTextWithMentions(note.text, note.mentions)}
              </p>
            ) : (
              <AutoTranslatedText
                as="p"
                text={note.text}
                className={cn("mt-2 whitespace-pre-wrap text-slate-800", compact ? "text-xs leading-5" : "text-sm leading-relaxed")}
              />
            )
          )}
          <ProgressAttachmentGrid attachments={note.attachments} compact={compact} className="mt-3" />
        </li>
      ))}
    </ul>
  );
}
