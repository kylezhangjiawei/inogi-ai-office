import { RD_MOTION_EASE } from "./taskMotion";
import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import {
  ChevronLeft,
  ChevronRight,
  Loader2,
  FileText,
  X,
} from "lucide-react";
import { cn } from "../components/ui/utils";
import { MobileZoomableImage } from "../components/MobileZoomableImage";
import { RenewableImage } from "../components/RenewableImage";
import { refreshRdAttachment } from "../lib/attachmentAccess";
import { useRenewableResource } from "../lib/useRenewableResource";
import { type RdTaskProgressAttachment, getAttachmentUrl, getAttachmentThumbUrl } from "../lib/rdApi";
import { ProgressAttachmentGrid } from "../RDProgressEvidence";
import { t } from "../lib/i18n";
import { Button } from "../components/ui/button";

// ─── Image lightbox (gallery preview) ─────────────────────────────────────────
export function ImageGallery({
  images,
  startIndex,
  onClose,
}: {
  images: RdTaskProgressAttachment[];
  startIndex: number;
  onClose: () => void;
}) {
  const [idx, setIdx] = useState(startIndex);
  const thumbnailStripRef = useRef<HTMLDivElement>(null);
  const shouldReduceMotion = useReducedMotion();
  const current = images[idx];
  const resource = useRenewableResource({
    src: getAttachmentUrl(current),
    resourceKey: `rd-original:${current.task_id}:${current.id}`,
    refresh: current.task_id ? async () => getAttachmentUrl(await refreshRdAttachment(current)) : undefined,
    refreshOnMount: true,
  });

  const prev = useCallback(() => setIdx((i) => (i - 1 + images.length) % images.length), [images.length]);
  const next = useCallback(() => setIdx((i) => (i + 1) % images.length), [images.length]);

  useEffect(() => {
    const strip = thumbnailStripRef.current;
    const thumbnail = strip?.children[idx] as HTMLElement | undefined;
    if (!strip || !thumbnail) return;
    // Only move the thumbnail viewport; do not scroll the page behind the gallery.
    const left = thumbnail.offsetLeft;
    const right = left + thumbnail.offsetWidth;
    if (left < strip.scrollLeft) strip.scrollLeft = left;
    else if (right > strip.scrollLeft + strip.clientWidth) strip.scrollLeft = right - strip.clientWidth;
  }, [idx]);

  useEffect(() => {
    const strip = thumbnailStripRef.current;
    if (!strip) return;
    const handleWheel = (event: WheelEvent) => {
      if (event.ctrlKey || Math.abs(event.deltaX) >= Math.abs(event.deltaY) || strip.scrollWidth <= strip.clientWidth) return;
      event.preventDefault();
      const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? strip.clientWidth : 1;
      strip.scrollLeft += event.deltaY * unit;
    };
    strip.addEventListener("wheel", handleWheel, { passive: false });
    return () => strip.removeEventListener("wheel", handleWheel);
  }, [images.length]);

  // Keyboard navigation
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft") prev();
      else if (e.key === "ArrowRight") next();
      else if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [prev, next, onClose]);

  return (
    <motion.div
      initial={shouldReduceMotion ? false : { opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.18 }}
      className="fixed inset-0 z-[90] flex flex-col items-center justify-center bg-black/92 backdrop-blur-sm"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={t("任务附件预览")}
    >
      {/* Close */}
      <Button variant="unstyled"
        type="button"
        onClick={onClose}
        className="absolute right-5 top-5 flex h-9 w-9 items-center justify-center rounded-full bg-white/10 text-white transition-colors motion-reduce:transition-none hover:bg-white/20"
        aria-label={t("关闭附件预览")}
      >
        <X className="h-5 w-5" />
      </Button>

      {/* Counter */}
      <div className="absolute top-5 left-1/2 -translate-x-1/2 rounded-full bg-white/10 px-3 py-1 text-xs font-semibold text-white/80 backdrop-blur-sm">
        {idx + 1} / {images.length}
      </div>

      {/* Main image */}
      <AnimatePresence mode="wait">
        <motion.div
          key={idx}
          initial={shouldReduceMotion ? false : { opacity: 0, scale: 0.96 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.96 }}
          transition={{ duration: 0.15, ease: RD_MOTION_EASE }}
          className="h-[78vh] w-[82vw] max-w-full"
          onClick={(e) => e.stopPropagation()}
        >
          {resource.failed ? (
            <div role="alert" className="flex h-full items-center justify-center text-sm text-white/80">{t("图片加载失败")}</div>
          ) : resource.src ? <MobileZoomableImage
            src={resource.src}
            alt={current.name}
            className="h-full w-full"
            imageClassName="rounded-2xl shadow-2xl"
            controlsClassName={images.length > 1 ? "!bottom-20" : undefined}
            stopPropagation={false}
            onLoad={resource.onLoad}
            onError={resource.onError}
          /> : (
            <div role="status" aria-label={t("正在加载图片")} className="flex h-full items-center justify-center text-white/80"><Loader2 className="h-6 w-6 animate-spin" /></div>
          )}
        </motion.div>
      </AnimatePresence>

      {/* Prev / Next */}
      {images.length > 1 && (
        <>
          <Button variant="unstyled"
            type="button"
            onClick={(e) => { e.stopPropagation(); prev(); }}
            className="absolute left-4 top-1/2 -translate-y-1/2 flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-white transition-colors motion-reduce:transition-none hover:bg-white/25 active:scale-95"
            aria-label={t("上一张附件")}
          >
            <ChevronLeft className="h-6 w-6" />
          </Button>
          <Button variant="unstyled"
            type="button"
            onClick={(e) => { e.stopPropagation(); next(); }}
            className="absolute right-4 top-1/2 -translate-y-1/2 flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-white transition-colors motion-reduce:transition-none hover:bg-white/25 active:scale-95"
            aria-label={t("下一张附件")}
          >
            <ChevronRight className="h-6 w-6" />
          </Button>
        </>
      )}

      {/* Thumbnail strip */}
      {images.length > 1 && (
        <div
          ref={thumbnailStripRef}
          className="rd-attachment-scroll rd-attachment-scroll-dark absolute bottom-5 flex w-max max-w-[calc(100%-2rem)] gap-2 overflow-x-auto overscroll-x-contain rounded-xl border border-white/15 bg-slate-900 px-2 pt-2 pb-3"
          aria-label={t("附件缩略图")}
          onClick={(event) => event.stopPropagation()}
        >
          {images.map((img, i) => (
            <Button variant="unstyled"
              key={img.id}
              type="button"
              onClick={(e) => { e.stopPropagation(); setIdx(i); }}
              aria-label={t("查看第 {index} 张附件：{name}", { index: i + 1, name: img.name })}
              aria-current={i === idx ? "true" : undefined}
              title={img.name}
              className={cn(
                "relative flex h-14 w-16 shrink-0 items-center justify-center overflow-hidden rounded-lg border-2 bg-black/30 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white sm:h-16 sm:w-20",
                i === idx ? "border-white" : "border-white/20 opacity-60 hover:opacity-100",
              )}
            >
              <RenewableImage
                resourceKey={`rd-thumb:${img.task_id}:${img.id}`}
                refresh={img.task_id ? async () => getAttachmentThumbUrl(await refreshRdAttachment(img)) : undefined}
                src={getAttachmentThumbUrl(img)} alt="" className="h-full w-full object-contain" loading="lazy" decoding="async"
              />
              <span className="absolute bottom-0 right-0 rounded-tl bg-black/70 px-1 text-[10px] leading-4 tabular-nums text-white">{i + 1}</span>
            </Button>
          ))}
        </div>
      )}
    </motion.div>
  );
}

// ─── Task image strip inside card ─────────────────────────────────────────────
export function TaskAttachmentStrip({
  attachments,
  totalCount,
  onOpenGallery,
  onOpenAll,
  loadingFull,
  priority = false,
}: {
  attachments: RdTaskProgressAttachment[];
  totalCount: number;
  onOpenGallery: (startIdx: number) => void;
  onOpenAll: () => void;
  loadingFull: boolean;
  priority?: boolean;
}) {
  const images = attachments.filter((attachment) => attachment.mime.startsWith("image/"));
  const files = attachments.filter((attachment) => !attachment.mime.startsWith("image/"));
  const cardPreviewSlots = 4;
  const visibleImages = images.slice(0, cardPreviewSlots);
  const visibleFiles = files.slice(0, Math.max(0, cardPreviewSlots - visibleImages.length));
  const extraCount = Math.max(0, totalCount - visibleImages.length - visibleFiles.length);

  return (
    <div className="rd-attachment-scroll flex min-w-0 max-w-full gap-1.5 overflow-x-auto overscroll-x-contain px-1 pt-1 pb-2" aria-label={t("附件预览")}>
        {visibleImages.map((img, imageIndex) => (
          <Button variant="unstyled"
            key={img.id}
            type="button"
            disabled={loadingFull}
            className="group/att relative h-12 w-[68px] shrink-0 cursor-pointer overflow-hidden rounded-lg border border-slate-200 bg-slate-100 transition-colors motion-reduce:transition-none hover:border-primary/25 hover:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/25 disabled:cursor-wait disabled:opacity-60"
            onClick={(e) => { e.stopPropagation(); onOpenGallery(imageIndex); }}
            title={img.name}
          >
            <RenewableImage
              resourceKey={`rd-thumb:${img.task_id}:${img.id}`}
              refresh={img.task_id ? async () => getAttachmentThumbUrl(await refreshRdAttachment(img)) : undefined}
              src={getAttachmentThumbUrl(img)}
              alt={img.name}
              className="h-full w-full object-cover transition-transform duration-200 group-hover/att:scale-[1.04]"
              loading={priority && imageIndex === 0 ? "eager" : "lazy"}
              decoding="async"
            />
          </Button>
        ))}

        {visibleFiles.map((file) => (
          <Button variant="unstyled"
            key={file.id}
            type="button"
            disabled={loadingFull}
            onClick={(event) => { event.stopPropagation(); onOpenAll(); }}
            className="flex h-12 w-[86px] shrink-0 items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 px-2 text-left transition-colors hover:border-primary/25 hover:bg-accent disabled:cursor-wait disabled:opacity-60"
            title={file.name}
          >
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-white text-indigo-600 ring-1 ring-slate-200">
              <FileText className="h-3.5 w-3.5" />
            </span>
            <span className="line-clamp-2 min-w-0 text-[9px] font-medium leading-snug text-slate-600">
              {file.name}
            </span>
          </Button>
        ))}

        {extraCount > 0 && (
          <Button variant="unstyled"
            type="button"
            disabled={loadingFull}
            onClick={(event) => { event.stopPropagation(); onOpenAll(); }}
            aria-label={t("查看其余 {count} 个附件", { count: extraCount })}
            className="flex h-12 min-w-12 shrink-0 items-center justify-center rounded-lg border border-dashed border-primary/25 bg-accent/70 px-2 text-xs font-bold tabular-nums text-primary transition-colors hover:border-primary hover:bg-accent disabled:cursor-wait disabled:opacity-60"
          >
            +{extraCount}
          </Button>
        )}
    </div>
  );
}

export function TaskAttachmentCollectionDialog({
  taskTitle,
  attachments,
  onClose,
}: {
  taskTitle: string;
  attachments: RdTaskProgressAttachment[];
  onClose: () => void;
}) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-[85] flex items-center justify-center bg-slate-950/72 px-4 py-6 backdrop-blur-sm" role="dialog" aria-modal="true" aria-label={t("全部附件")}>
      <div className="absolute inset-0" onClick={onClose} aria-hidden="true" />
      <div className="relative flex max-h-[88vh] w-full max-w-5xl flex-col overflow-hidden rounded-xl border border-white/10 bg-white shadow-2xl">
        <div className="flex items-center justify-between gap-3 border-b border-slate-200 px-4 py-3">
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold text-slate-900">{taskTitle}</div>
            <div className="mt-0.5 text-xs text-slate-500">{t("全部附件")} · {attachments.length}</div>
          </div>
          <Button variant="unstyled"
            type="button"
            onClick={onClose}
            className="flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg border border-slate-200 text-slate-500 transition hover:bg-slate-50 hover:text-slate-800"
            aria-label={t("关闭附件列表")}
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          <ProgressAttachmentGrid attachments={attachments} />
        </div>
      </div>
    </div>
  );
}
