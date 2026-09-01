import React, { createContext, useCallback, useContext, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronLeft, ChevronRight, Download, FileText, ImageIcon, Loader2, Paperclip, PlayCircle, RefreshCw, Table2, Trash2, Video, X, ZoomIn, ZoomOut } from "lucide-react";
import { cn } from "./components/ui/utils";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "./components/ui/dialog";
import { currentI18nLang, i18nLocale, t, useI18n } from "./lib/i18n";
import { renderTextWithMentions } from "./components/MentionInput";
import { AutoTranslatedText } from "./components/TranslatableText";
import { getAttachmentDownloadUrl, getAttachmentPreviewUrl, getAttachmentThumbUrl, getAttachmentUrl, type RdTaskProgressAttachment, type RdTaskProgressNote } from "./lib/rdApi";
import { parseXlsxForPreview, type XlsxPreviewSheet } from "./lib/xlsxPreview";
import { isMobileViewport } from "./lib/mobileRouting";
import {
  closeMobileOverlay,
  pushMobileOverlayState,
  useMobileOverlayBack,
} from "./hooks/useMobileOverlay";
import {
  TASK_IMAGE_DOUBLE_TAP_SCALE,
  TASK_IMAGE_MIN_SCALE,
  TASK_IMAGE_ZOOM_STEP,
  clampTaskImageTransform,
  distanceBetweenPointers,
  midpointBetweenPointers,
  pinchTaskImageTransform,
  zoomTaskImageTransform,
  type PointerPosition,
  type TaskImageTransform,
  type TaskImageViewport,
} from "./lib/taskImageGesture";

const TASK_GALLERY_OVERLAY = "rd-task-image-gallery";
const ATTACHMENT_PREVIEW_OVERLAY = "rd-attachment-preview";
const MOBILE_ATTACHMENT_PREVIEW_EVENT = "rd:open-mobile-attachment-preview";
const CLIPPED_CARD_WIDTH = 156;
const CLIPPED_CARD_GAP = 8;

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

export type GalleryImage = {
  att: RdTaskProgressAttachment;
  createdAt: string;
  date: string;
  actor: string;
};

type MobileAttachmentPreviewDetail =
  | { kind: "image-gallery"; images: GalleryImage[]; index: number }
  | { kind: "attachment"; attachment: RdTaskProgressAttachment };

const TaskImageGalleryContext = createContext<GalleryImage[] | null>(null);

function collectTaskGalleryImages(notes: RdTaskProgressNote[]): GalleryImage[] {
  const images: GalleryImage[] = [];
  for (const note of notes) {
    for (const att of note.attachments ?? []) {
      if ((att.mime ?? "").startsWith("image/")) {
        images.push({
          att,
          createdAt: note.created_at ?? "",
          date: (note.created_at ?? "").slice(0, 10) || "未知日期",
          actor: note.actor?.name ?? "",
        });
      }
    }
  }
  return images.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

function attachmentsToGalleryImages(attachments: RdTaskProgressAttachment[]): GalleryImage[] {
  return attachments
    .filter((att) => (att.mime ?? "").startsWith("image/"))
    .map((att) => ({ att, createdAt: "", date: "未知日期", actor: "" }));
}

/**
 * 给任务详情中的所有附件卡片共享同一份图片序列。这样从任意一条留痕点开图片，
 * 都能继续浏览当前任务其他留痕里的图片，而不必关闭弹窗再逐张打开。
 */
export function TaskImageGalleryScope({
  notes,
  children,
}: {
  notes: RdTaskProgressNote[];
  children: React.ReactNode;
}) {
  const images = useMemo(() => collectTaskGalleryImages(notes), [notes]);
  return <TaskImageGalleryContext.Provider value={images}>{children}</TaskImageGalleryContext.Provider>;
}

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
  const images = useMemo(() => collectTaskGalleryImages(notes), [notes]);

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
  const galleryPanelId = useId();
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
    <div className={cn("rd-task-image-gallery rounded-xl border border-slate-100 bg-slate-50/60 px-3 py-2.5", className)}>
      <button
        type="button"
        onClick={() => setCollapsed((prev) => !prev)}
        aria-expanded={!collapsed}
        aria-controls={galleryPanelId}
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
        <div id={galleryPanelId} className="mt-2 max-h-[300px] space-y-2.5 overflow-y-auto">
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
                    className="size-[72px] shrink-0 cursor-pointer overflow-hidden rounded-lg border border-slate-200 bg-slate-100 hover:border-[#002fa7]/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#002fa7]/30"
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
export function TaskImageLightbox({
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
  // The responsive desktop task-detail route is also used directly on phones.
  // Enable gestures by actual viewport as well as by the dedicated /m route.
  const zoomEnabled = isMobileRoute() || isMobileViewport();
  const currentImageId = current.att.id;
  const currentUrl = getAttachmentUrl(current.att);
  const gestureViewportRef = useRef<HTMLDivElement>(null);
  const carouselFrameRef = useRef<HTMLDivElement>(null);
  const imageFrameRef = useRef<HTMLDivElement>(null);
  const imageElementRef = useRef<HTMLImageElement>(null);
  const zoomLabelRef = useRef<HTMLSpanElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const activePointersRef = useRef(new Map<number, PointerPosition>());
  const gestureLayoutRef = useRef<(TaskImageViewport & { center: PointerPosition }) | null>(null);
  const imageTransformRef = useRef<TaskImageTransform>({ scale: TASK_IMAGE_MIN_SCALE, x: 0, y: 0 });
  const pendingImageTransformRef = useRef<TaskImageTransform | null>(null);
  const imageTransformFrameRef = useRef<number | null>(null);
  const gestureStartTransformRef = useRef<TaskImageTransform>({ scale: TASK_IMAGE_MIN_SCALE, x: 0, y: 0 });
  const gestureStartPointerRef = useRef<PointerPosition | null>(null);
  const pinchStartDistanceRef = useRef<number | null>(null);
  const pinchStartMidpointRef = useRef<PointerPosition | null>(null);
  const pointerStartXRef = useRef<number | null>(null);
  const draggedRef = useRef(false);
  const hadMultitouchRef = useRef(false);
  const suppressBackdropClickRef = useRef(false);
  const lastWheelNavigationRef = useRef(0);
  const [loadedUrl, setLoadedUrl] = useState<string | null>(null);

  const moveTo = useCallback((nextIndex: number) => {
    if (nextIndex < 0 || nextIndex >= images.length || nextIndex === index) return;
    onIndexChange(nextIndex);
  }, [images.length, index, onIndexChange]);

  const setGalleryOffset = useCallback((offset: number, animate: boolean) => {
    const frame = carouselFrameRef.current;
    if (!frame) return;
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    frame.style.transition = animate && !reduceMotion ? "transform 160ms ease-out" : "none";
    frame.style.transform = `translate3d(${offset}px, 0, 0)`;
  }, []);

  const measureGestureLayout = useCallback(() => {
    const viewport = gestureViewportRef.current;
    if (!viewport) return null;
    const image = imageElementRef.current;
    const rect = viewport.getBoundingClientRect();
    const layout = {
      width: viewport.clientWidth,
      height: viewport.clientHeight,
      imageWidth: image?.offsetWidth || viewport.clientWidth,
      imageHeight: image?.offsetHeight || viewport.clientHeight,
      center: { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 },
    };
    gestureLayoutRef.current = layout;
    return layout;
  }, []);

  const applyImageTransform = useCallback((next: TaskImageTransform, animate: boolean) => {
    const frame = imageFrameRef.current;
    const layout = gestureLayoutRef.current ?? measureGestureLayout();
    if (!frame || !layout) return imageTransformRef.current;
    const normalized = clampTaskImageTransform(next, layout);
    imageTransformRef.current = normalized;
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    frame.style.transition = animate && !reduceMotion ? "transform 180ms ease-out" : "none";
    frame.style.transform = `translate3d(${normalized.x}px, ${normalized.y}px, 0) scale(${normalized.scale})`;
    if (zoomLabelRef.current) zoomLabelRef.current.textContent = `${Math.round(normalized.scale * 100)}%`;
    return normalized;
  }, [measureGestureLayout]);

  const scheduleImageTransform = useCallback((next: TaskImageTransform) => {
    pendingImageTransformRef.current = next;
    if (imageTransformFrameRef.current != null) return;
    imageTransformFrameRef.current = window.requestAnimationFrame(() => {
      imageTransformFrameRef.current = null;
      const pending = pendingImageTransformRef.current;
      pendingImageTransformRef.current = null;
      if (pending) applyImageTransform(pending, false);
    });
  }, [applyImageTransform]);

  const flushScheduledImageTransform = useCallback(() => {
    if (imageTransformFrameRef.current != null) {
      window.cancelAnimationFrame(imageTransformFrameRef.current);
      imageTransformFrameRef.current = null;
    }
    const pending = pendingImageTransformRef.current;
    pendingImageTransformRef.current = null;
    if (pending) applyImageTransform(pending, false);
  }, [applyImageTransform]);

  const resetImageTransform = useCallback((animate: boolean) => {
    return applyImageTransform({ scale: TASK_IMAGE_MIN_SCALE, x: 0, y: 0 }, animate);
  }, [applyImageTransform]);

  const zoomImageTo = useCallback((requestedScale: number, focus?: PointerPosition, animate = true) => {
    const currentTransform = imageTransformRef.current;
    const layout = gestureLayoutRef.current ?? measureGestureLayout();
    if (!layout || !focus) {
      return applyImageTransform({ ...currentTransform, scale: requestedScale }, animate);
    }
    return applyImageTransform(zoomTaskImageTransform(currentTransform, requestedScale, focus, layout.center), animate);
  }, [applyImageTransform, measureGestureLayout]);

  const finishPointerGesture = useCallback((event: React.PointerEvent<HTMLDivElement>, cancelled = false) => {
    if (!activePointersRef.current.has(event.pointerId)) return;
    flushScheduledImageTransform();
    const wasMultitouch = hadMultitouchRef.current;
    const swipeStartX = pointerStartXRef.current;
    activePointersRef.current.delete(event.pointerId);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    suppressBackdropClickRef.current = draggedRef.current || wasMultitouch;

    if (activePointersRef.current.size > 0) {
      const remainingPointers = Array.from(activePointersRef.current.values());
      const remainingPointer = remainingPointers[0];
      gestureStartPointerRef.current = remainingPointer ?? null;
      gestureStartTransformRef.current = { ...imageTransformRef.current };
      pinchStartDistanceRef.current = remainingPointers.length >= 2
        ? distanceBetweenPointers(remainingPointers[0], remainingPointers[1])
        : null;
      pinchStartMidpointRef.current = remainingPointers.length >= 2
        ? midpointBetweenPointers(remainingPointers[0], remainingPointers[1])
        : null;
      pointerStartXRef.current = null;
      return;
    }

    const deltaX = swipeStartX == null ? 0 : event.clientX - swipeStartX;
    const threshold = Math.min(120, Math.max(48, event.currentTarget.clientWidth * 0.08));
    const nextIndex = deltaX < 0 ? index + 1 : index - 1;
    const canMove = !cancelled
      && !wasMultitouch
      && imageTransformRef.current.scale === TASK_IMAGE_MIN_SCALE
      && Math.abs(deltaX) >= threshold
      && nextIndex >= 0
      && nextIndex < images.length;
    pointerStartXRef.current = null;
    gestureStartPointerRef.current = null;
    pinchStartDistanceRef.current = null;
    pinchStartMidpointRef.current = null;
    draggedRef.current = false;
    hadMultitouchRef.current = false;
    setGalleryOffset(0, !canMove);
    if (canMove) moveTo(nextIndex);
  }, [flushScheduledImageTransform, images.length, index, moveTo, setGalleryOffset]);

  useLayoutEffect(() => {
    flushScheduledImageTransform();
    activePointersRef.current.clear();
    pointerStartXRef.current = null;
    gestureStartPointerRef.current = null;
    pinchStartDistanceRef.current = null;
    pinchStartMidpointRef.current = null;
    draggedRef.current = false;
    hadMultitouchRef.current = false;
    setGalleryOffset(0, false);
    resetImageTransform(false);
  }, [currentImageId, flushScheduledImageTransform, resetImageTransform, setGalleryOffset]);

  useLayoutEffect(() => {
    const viewport = gestureViewportRef.current;
    if (!viewport) return undefined;
    const updateLayout = () => {
      measureGestureLayout();
      applyImageTransform(imageTransformRef.current, false);
    };
    updateLayout();
    if (typeof ResizeObserver === "undefined") return undefined;
    const observer = new ResizeObserver(updateLayout);
    observer.observe(viewport);
    if (imageElementRef.current) observer.observe(imageElementRef.current);
    return () => observer.disconnect();
  }, [applyImageTransform, currentImageId, measureGestureLayout]);

  useEffect(() => () => {
    if (imageTransformFrameRef.current != null) window.cancelAnimationFrame(imageTransformFrameRef.current);
  }, []);

  useEffect(() => {
    const neighborUrls = [images[index - 1], images[index + 1]]
      .filter((image): image is GalleryImage => Boolean(image))
      .map((image) => getAttachmentUrl(image.att))
      .filter(Boolean);
    for (const url of neighborUrls) {
      const preload = new Image();
      preload.src = url;
    }
  }, [images, index]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "ArrowLeft" && hasPrev) moveTo(index - 1);
      if (event.key === "ArrowRight" && hasNext) moveTo(index + 1);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [index, hasPrev, hasNext, moveTo, onClose]);

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
    <DialogContent
      aria-label={`图片预览：${current.att.name}`}
      onOpenAutoFocus={(event) => {
        event.preventDefault();
        closeButtonRef.current?.focus();
      }}
      className="horizon-portal inset-0 left-0 top-0 flex h-dvh w-full max-w-none translate-x-0 translate-y-0 flex-col gap-0 overflow-hidden rounded-none border-0 bg-slate-950/90 p-0 shadow-none sm:max-w-none [&>button:last-child]:hidden"
    >
      <DialogTitle className="sr-only">{`图片预览：${current.att.name}`}</DialogTitle>
      <DialogDescription className="sr-only">{t("可使用左右方向键切换图片；移动端支持双指缩放和拖动。")}</DialogDescription>
      <div className="flex items-center justify-between gap-3 px-4 pb-3 pt-[max(0.75rem,env(safe-area-inset-top))] text-white">
        <div className="min-w-0">
          <div className="truncate text-balance text-sm font-semibold">{current.att.name}</div>
          <div className="mt-0.5 text-xs tabular-nums text-white/60">
            {index + 1} / {images.length}
            {current.date !== "未知日期" ? ` · ${current.date}` : ""}
            {current.actor ? ` · ${current.actor}` : ""}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {zoomEnabled && (
            <>
              <button
                type="button"
                onClick={() => zoomImageTo(imageTransformRef.current.scale - TASK_IMAGE_ZOOM_STEP)}
                className="flex h-9 w-9 cursor-pointer items-center justify-center rounded-full bg-white/10 text-white/90 transition hover:bg-white/20"
                aria-label="缩小图片"
              >
                <ZoomOut className="h-4 w-4" />
              </button>
              <span ref={zoomLabelRef} className="w-11 text-center text-[11px] tabular-nums text-white/70" aria-live="polite">100%</span>
              <button
                type="button"
                onClick={() => zoomImageTo(imageTransformRef.current.scale + TASK_IMAGE_ZOOM_STEP)}
                className="flex h-9 w-9 cursor-pointer items-center justify-center rounded-full bg-white/10 text-white/90 transition hover:bg-white/20"
                aria-label="放大图片"
              >
                <ZoomIn className="h-4 w-4" />
              </button>
            </>
          )}
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
            ref={closeButtonRef}
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
        ref={gestureViewportRef}
        className={cn(
          "relative flex min-h-0 flex-1 select-none items-center justify-center px-2 pb-[max(1.5rem,env(safe-area-inset-bottom))] sm:px-14",
          zoomEnabled ? "touch-none overflow-hidden" : "touch-pan-y",
        )}
        aria-label={zoomEnabled ? "图片手势区域，可双指缩放，放大后拖动" : undefined}
        onPointerDown={(event) => {
          if (event.pointerType === "mouse" && event.button !== 0) return;
          if (!zoomEnabled && !event.isPrimary) return;
          // 导航按钮属于点击控件，不能让外层滑动区捕获它的 pointer。
          // 否则 pointerup/click 会被重定向到遮罩容器并触发关闭预览。
          if (event.target instanceof Element && event.target.closest("button, a")) return;
          const point = { x: event.clientX, y: event.clientY };
          measureGestureLayout();
          activePointersRef.current.set(event.pointerId, point);
          event.currentTarget.setPointerCapture(event.pointerId);
          if (activePointersRef.current.size === 1) {
            gestureStartPointerRef.current = point;
            gestureStartTransformRef.current = { ...imageTransformRef.current };
            pointerStartXRef.current = imageTransformRef.current.scale === TASK_IMAGE_MIN_SCALE ? event.clientX : null;
            draggedRef.current = false;
            return;
          }
          const [first, second] = Array.from(activePointersRef.current.values());
          hadMultitouchRef.current = true;
          draggedRef.current = true;
          pointerStartXRef.current = null;
          pinchStartDistanceRef.current = distanceBetweenPointers(first, second);
          pinchStartMidpointRef.current = midpointBetweenPointers(first, second);
          gestureStartTransformRef.current = { ...imageTransformRef.current };
        }}
        onPointerMove={(event) => {
          if (!activePointersRef.current.has(event.pointerId)) return;
          activePointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
          const points = Array.from(activePointersRef.current.values());
          if (points.length >= 2) {
            if (!zoomEnabled) return;
            const [first, second] = points;
            const startDistance = pinchStartDistanceRef.current || distanceBetweenPointers(first, second);
            const startMidpoint = pinchStartMidpointRef.current || midpointBetweenPointers(first, second);
            const midpoint = midpointBetweenPointers(first, second);
            const startTransform = gestureStartTransformRef.current;
            const viewportCenter = gestureLayoutRef.current?.center ?? { x: 0, y: 0 };
            scheduleImageTransform(pinchTaskImageTransform({
              startTransform,
              startDistance,
              currentDistance: distanceBetweenPointers(first, second),
              startMidpoint,
              currentMidpoint: midpoint,
              viewportCenter,
            }));
            return;
          }

          const startPoint = gestureStartPointerRef.current;
          if (!startPoint) return;
          const deltaX = event.clientX - startPoint.x;
          const deltaY = event.clientY - startPoint.y;
          if (Math.hypot(deltaX, deltaY) > 6) draggedRef.current = true;
          if (imageTransformRef.current.scale > TASK_IMAGE_MIN_SCALE) {
            const startTransform = gestureStartTransformRef.current;
            scheduleImageTransform({ ...startTransform, x: startTransform.x + deltaX, y: startTransform.y + deltaY });
            return;
          }
          let galleryOffset = deltaX;
          if ((!hasPrev && galleryOffset > 0) || (!hasNext && galleryOffset < 0)) galleryOffset *= 0.22;
          setGalleryOffset(galleryOffset, false);
        }}
        onPointerUp={finishPointerGesture}
        onPointerCancel={(event) => finishPointerGesture(event, true)}
        onLostPointerCapture={(event) => finishPointerGesture(event, true)}
        onDoubleClick={zoomEnabled ? (event) => {
          const nextScale = imageTransformRef.current.scale > TASK_IMAGE_MIN_SCALE ? TASK_IMAGE_MIN_SCALE : TASK_IMAGE_DOUBLE_TAP_SCALE;
          zoomImageTo(nextScale, { x: event.clientX, y: event.clientY });
        } : undefined}
        onWheel={(event) => {
          if (imageTransformRef.current.scale > TASK_IMAGE_MIN_SCALE) return;
          if (Math.abs(event.deltaX) <= Math.abs(event.deltaY) || Math.abs(event.deltaX) < 36) return;
          event.preventDefault();
          const now = Date.now();
          if (now - lastWheelNavigationRef.current < 320) return;
          lastWheelNavigationRef.current = now;
          moveTo(event.deltaX > 0 ? index + 1 : index - 1);
        }}
        onClick={(event) => {
          if (suppressBackdropClickRef.current) {
            suppressBackdropClickRef.current = false;
            return;
          }
          if (shouldCloseFromBackdrop(event)) onClose();
        }}
      >
        {hasPrev && (
          <button
            type="button"
            onClick={() => moveTo(index - 1)}
            className="absolute left-2 top-1/2 z-10 hidden size-11 -translate-y-1/2 cursor-pointer items-center justify-center rounded-full bg-white/10 text-white transition hover:bg-white/25 sm:flex"
            aria-label="上一张"
          >
            <ChevronLeft className="h-6 w-6" />
          </button>
        )}
        <div ref={carouselFrameRef} className="relative flex h-full w-full items-center justify-center">
          {loadedUrl !== currentUrl && <Loader2 className="absolute size-7 animate-spin text-white/70" aria-hidden="true" />}
          <div ref={imageFrameRef} className="relative flex h-full w-full origin-center items-center justify-center">
            <img
              ref={imageElementRef}
              key={currentUrl}
              src={currentUrl}
              alt={current.att.name}
              loading="eager"
              decoding="async"
              draggable={false}
              onLoad={() => {
                setLoadedUrl(currentUrl);
                measureGestureLayout();
                applyImageTransform(imageTransformRef.current, false);
              }}
              className={cn(
                "relative max-h-full max-w-full rounded-lg object-contain shadow-2xl",
                loadedUrl === currentUrl ? "opacity-100" : "opacity-0",
              )}
            />
          </div>
        </div>
        {hasNext && (
          <button
            type="button"
            onClick={() => moveTo(index + 1)}
            className="absolute right-2 top-1/2 z-10 hidden size-11 -translate-y-1/2 cursor-pointer items-center justify-center rounded-full bg-white/10 text-white transition hover:bg-white/25 sm:flex"
            aria-label="下一张"
          >
            <ChevronRight className="h-6 w-6" />
          </button>
        )}
      </div>
    </DialogContent>
    </Dialog>
  );
}

export function ProgressAttachmentGrid({
  attachments,
  compact = false,
  imageDisplay = "cards",
  maxVisibleImages = 3,
  className,
  onDeleteAttachment,
  onReplaceAttachment,
}: {
  attachments: RdTaskProgressAttachment[];
  compact?: boolean;
  /** 留言使用缩略图；任务详情使用单行卡片，超出容器宽度的附件不渲染。 */
  imageDisplay?: "cards" | "thumbnails" | "clipped-cards";
  maxVisibleImages?: number;
  className?: string;
  /** 可选：附件管理回调（工作台传入）。不传时纯展示，其他页面行为不变。 */
  onDeleteAttachment?: (att: RdTaskProgressAttachment) => void;
  onReplaceAttachment?: (att: RdTaskProgressAttachment) => void;
}) {
  const [preview, setPreview] = useState<RdTaskProgressAttachment | null>(null);
  const [galleryPreview, setGalleryPreview] = useState<{ images: GalleryImage[]; index: number } | null>(null);
  const clippedCardContainerRef = useRef<HTMLDivElement>(null);
  const [visibleCardCount, setVisibleCardCount] = useState(1);
  const taskImages = useContext(TaskImageGalleryContext);
  const dismissGalleryPreview = useCallback(() => setGalleryPreview(null), []);
  const dismissAnyPreview = useCallback(() => {
    setPreview(null);
    setGalleryPreview(null);
  }, []);
  useMobileOverlayBack(Boolean(preview || galleryPreview), ATTACHMENT_PREVIEW_OVERLAY, dismissAnyPreview);
  const managed = Boolean(onDeleteAttachment || onReplaceAttachment);
  const thumbnailMode = imageDisplay === "thumbnails";
  const clippedCardMode = imageDisplay === "clipped-cards";

  useLayoutEffect(() => {
    if (!clippedCardMode) return undefined;
    const container = clippedCardContainerRef.current;
    if (!container) return undefined;
    const updateVisibleCardCount = () => {
      const next = Math.max(1, Math.floor((container.clientWidth + CLIPPED_CARD_GAP) / (CLIPPED_CARD_WIDTH + CLIPPED_CARD_GAP)));
      setVisibleCardCount((current) => current === next ? current : next);
    };
    updateVisibleCardCount();
    if (typeof ResizeObserver === "undefined") return undefined;
    const observer = new ResizeObserver(updateVisibleCardCount);
    observer.observe(container);
    return () => observer.disconnect();
  }, [clippedCardMode]);

  const {
    imageAttachments,
    renderedAttachments,
    hiddenImageCount,
    lastVisibleImageId,
  } = useMemo(() => {
    const images = attachments.filter((attachment) => (attachment.mime ?? "").startsWith("image/"));
    if (clippedCardMode) {
      const visibleImages = images.slice(0, visibleCardCount);
      return {
        imageAttachments: images,
        // 图片只占一行，宽度外的不挂载；文档/视频继续完整显示在后续行，避免附件丢失。
        renderedAttachments: [
          ...visibleImages,
          ...attachments.filter((attachment) => !(attachment.mime ?? "").startsWith("image/")),
        ],
        hiddenImageCount: 0,
        lastVisibleImageId: null,
      };
    }
    if (!thumbnailMode) {
      return {
        imageAttachments: images,
        renderedAttachments: attachments,
        hiddenImageCount: 0,
        lastVisibleImageId: null,
      };
    }

    const normalizedImageLimit = Math.max(1, Math.floor(maxVisibleImages));
    const visibleImages = images.slice(0, normalizedImageLimit);
    const visibleImageIds = new Set(visibleImages.map((attachment) => attachment.id));
    return {
      imageAttachments: images,
      renderedAttachments: attachments.filter((attachment) => (
        !(attachment.mime ?? "").startsWith("image/") || visibleImageIds.has(attachment.id)
      )),
      hiddenImageCount: Math.max(0, images.length - visibleImages.length),
      lastVisibleImageId: visibleImages.at(-1)?.id ?? null,
    };
  }, [attachments, clippedCardMode, maxVisibleImages, thumbnailMode, visibleCardCount]);

  const openPreview = (attachment: RdTaskProgressAttachment) => {
    const isImage = (attachment.mime ?? "").startsWith("image/");
    const scopedImages = taskImages?.some((image) => image.att.id === attachment.id)
      ? taskImages
      : attachmentsToGalleryImages(attachments);
    const galleryIndex = isImage ? scopedImages.findIndex((image) => image.att.id === attachment.id) : -1;
    const detail: MobileAttachmentPreviewDetail = isImage && galleryIndex >= 0
      ? { kind: "image-gallery", images: scopedImages, index: galleryIndex }
      : { kind: "attachment", attachment };
    if (isMobileRoute()) {
      const event = new CustomEvent<MobileAttachmentPreviewDetail>(MOBILE_ATTACHMENT_PREVIEW_EVENT, {
        detail,
        cancelable: true,
      });
      // The mobile page-level host owns the preview so polling or rebuilding a
      // message card cannot unmount it. Fall back to local state on pages that
      // do not mount the host.
      if (!window.dispatchEvent(event)) return;
    }
    pushMobileOverlayState(ATTACHMENT_PREVIEW_OVERLAY);
    if (detail.kind === "image-gallery") setGalleryPreview({ images: detail.images, index: detail.index });
    else setPreview(detail.attachment);
  };
  const closePreview = useCallback(
    () => closeMobileOverlay(ATTACHMENT_PREVIEW_OVERLAY, dismissAnyPreview),
    [dismissAnyPreview],
  );

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
      <div
        ref={clippedCardMode ? clippedCardContainerRef : undefined}
        className={cn(
          clippedCardMode
            ? "flex flex-wrap items-start gap-2"
            : thumbnailMode ? "flex flex-wrap items-start gap-1.5" : "grid",
          !clippedCardMode && !thumbnailMode && (compact ? "grid-cols-[repeat(auto-fit,minmax(140px,1fr))] gap-1" : "gap-2 sm:grid-cols-2"),
          className,
        )}
      >
        {renderedAttachments.map((att) => {
          const isImage = (att.mime ?? "").startsWith("image/");
          const isVideo = (att.mime ?? "").startsWith("video/");
          if (isImage) {
            const imagePosition = imageAttachments.findIndex((image) => image.id === att.id) + 1;
            const showsHiddenCount = thumbnailMode && hiddenImageCount > 0 && att.id === lastVisibleImageId;
            return (
              <div
                key={att.id}
                className={cn(
                  "group/att relative",
                  thumbnailMode && "size-16 shrink-0 sm:size-[68px]",
                  clippedCardMode && "w-[156px] shrink-0",
                )}
              >
                {renderActions(att)}
                <button
                  type="button"
                  onClick={() => openPreview(att)}
                  title={`${att.name} · ${formatRdFileSize(att.size)}`}
                  aria-label={thumbnailMode ? `预览图片 ${imagePosition}/${imageAttachments.length}：${att.name}` : undefined}
                  className={cn(
                    "group block w-full cursor-pointer overflow-hidden rounded-[8px] border border-slate-200 bg-slate-50 text-left hover:border-[#002fa7]/30 hover:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#002fa7]/30",
                    thumbnailMode && "h-full bg-white",
                  )}
                >
                  <div className={cn(
                    "relative overflow-hidden bg-slate-100",
                    thumbnailMode ? "h-full" : clippedCardMode ? "h-16" : compact ? "h-12" : "h-32",
                  )}>
                    <img
                      src={getAttachmentThumbUrl(att)}
                      alt={att.name}
                      className="h-full w-full object-cover"
                      loading="lazy"
                      decoding="async"
                    />
                    {!thumbnailMode ? (
                      <span className={cn(
                        "absolute inline-flex items-center gap-1 rounded bg-white/90 px-1.5 py-0.5 text-[9px] font-semibold text-slate-600 shadow-sm",
                        compact ? "left-1 top-1" : "left-2 top-2",
                      )}>
                        <ImageIcon className="h-3 w-3 text-blue-500" />
                        图片
                      </span>
                    ) : null}
                    {showsHiddenCount ? (
                      <span className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center bg-slate-950/70 text-white">
                        <span className="text-base font-bold leading-none">+{hiddenImageCount}</span>
                        <span className="mt-1 text-[9px] font-semibold">{t("查看全部")}</span>
                      </span>
                    ) : null}
                  </div>
                  {!thumbnailMode ? (
                    <div className={cn("flex items-center justify-between gap-2", compact ? "px-1.5 py-1" : "px-2 py-1.5")}>
                      <span className={cn("min-w-0 truncate font-medium text-slate-700", compact ? "text-[10px]" : "text-[11px]")}>{att.name}</span>
                      <span className="shrink-0 text-[9px] text-slate-400">{formatRdFileSize(att.size)}</span>
                    </div>
                  ) : null}
                </button>
              </div>
            );
          }

          if (isVideo) {
            return (
              <div key={att.id} className={cn("group/att relative", thumbnailMode && "w-full", clippedCardMode && "w-[156px] shrink-0")}>
                {renderActions(att)}
                <button
                  type="button"
                  onClick={() => openPreview(att)}
                  title={`${att.name} · ${formatRdFileSize(att.size)}`}
                  className="group block w-full cursor-pointer overflow-hidden rounded-[8px] border border-slate-200 bg-slate-950 text-left hover:border-[#002fa7]/30 hover:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#002fa7]/30"
                >
                  <div className={cn("relative overflow-hidden bg-slate-900", clippedCardMode ? "h-16" : compact ? "h-12" : "h-32")}>
                    <video
                      src={getAttachmentUrl(att)}
                      className="h-full w-full object-cover opacity-80"
                      preload="metadata"
                      muted
                      playsInline
                      aria-label={att.name}
                    />
                    <span className="absolute inset-0 flex items-center justify-center">
                      <span className="flex size-9 items-center justify-center rounded-full bg-white/90 text-[#002fa7] shadow-lg">
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
            <div key={att.id} className={cn("group/att relative", thumbnailMode && "w-full", clippedCardMode && "w-[156px] shrink-0")}>
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
      {galleryPreview && galleryPreview.images[galleryPreview.index] && (
        <TaskImageLightbox
          images={galleryPreview.images}
          index={galleryPreview.index}
          onIndexChange={(next) => setGalleryPreview((currentPreview) => currentPreview ? { ...currentPreview, index: next } : null)}
          onClose={() => closeMobileOverlay(ATTACHMENT_PREVIEW_OVERLAY, dismissGalleryPreview)}
        />
      )}
    </>
  );
}

/**
 * Mobile-only persistent preview owner. It is mounted above the conversation
 * cards so background refreshes, thread hydration and list reconciliation do
 * not destroy an already-open attachment preview.
 */
export function MobileAttachmentPreviewHost() {
  const [preview, setPreview] = useState<MobileAttachmentPreviewDetail | null>(null);
  const dismissPreview = useCallback(() => setPreview(null), []);
  const closePreview = useCallback(
    () => closeMobileOverlay(ATTACHMENT_PREVIEW_OVERLAY, dismissPreview),
    [dismissPreview],
  );

  useMobileOverlayBack(Boolean(preview), ATTACHMENT_PREVIEW_OVERLAY, dismissPreview);

  useEffect(() => {
    const handleOpen = (event: Event) => {
      const detail = (event as CustomEvent<MobileAttachmentPreviewDetail>).detail;
      if (!detail) return;
      event.preventDefault();
      pushMobileOverlayState(ATTACHMENT_PREVIEW_OVERLAY);
      setPreview(detail);
    };
    window.addEventListener(MOBILE_ATTACHMENT_PREVIEW_EVENT, handleOpen);
    return () => window.removeEventListener(MOBILE_ATTACHMENT_PREVIEW_EVENT, handleOpen);
  }, []);

  if (!preview) return null;
  if (preview.kind === "image-gallery") {
    return preview.images[preview.index] ? (
      <TaskImageLightbox
        images={preview.images}
        index={preview.index}
        onIndexChange={(next) => setPreview((currentPreview) => currentPreview?.kind === "image-gallery" ? { ...currentPreview, index: next } : currentPreview)}
        onClose={closePreview}
      />
    ) : null;
  }
  return <AttachmentPreviewModal attachment={preview.attachment} onClose={closePreview} />;
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
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
    <DialogContent
      aria-label={`附件预览：${attachment.name}`}
      onOpenAutoFocus={(event) => {
        event.preventDefault();
        closeButtonRef.current?.focus();
      }}
      onPointerDownOutside={(event) => { if (isMobileRoute()) event.preventDefault(); }}
      className="horizon-portal flex max-h-[88dvh] gap-0 overflow-hidden rounded-xl border-slate-200 bg-white p-0 shadow-xl sm:max-w-5xl [&>button:last-child]:hidden"
    >
      <div className="relative flex min-h-0 w-full flex-col overflow-hidden">
        <div className="flex items-center justify-between gap-3 border-b border-slate-200 px-4 py-3">
          <div className="min-w-0">
            <DialogTitle className="truncate text-balance text-sm font-semibold text-[#1b2559]">{attachment.name}</DialogTitle>
            <DialogDescription className="mt-0.5 truncate text-xs tabular-nums text-slate-500">
              {attachment.mime || "未知类型"} · {formatRdFileSize(attachment.size)}
            </DialogDescription>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <a
              href={getAttachmentDownloadUrl(attachment)}
              download={attachment.name}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex h-8 items-center gap-1.5 rounded-full border border-[#dce6ff] bg-white px-3 text-xs font-semibold text-[#002fa7] hover:bg-[#eef3ff] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#002fa7]/30"
            >
              <Download className="h-3.5 w-3.5" />
              下载
            </a>
            <button
              ref={closeButtonRef}
              type="button"
              onClick={onClose}
              className="flex size-8 cursor-pointer items-center justify-center rounded-full border border-slate-200 text-slate-500 hover:bg-slate-50 hover:text-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#002fa7]/30"
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
              <div className="mt-4 text-balance text-sm font-semibold text-[#1b2559]">当前格式暂不支持内嵌预览</div>
              <p className="mt-2 text-pretty text-xs leading-5 text-slate-500">
                文件已保留在当前留痕记录中，可直接下载查看，不会离开当前驾驶舱页面。
              </p>
            </div>
          )}
        </div>
      </div>
    </DialogContent>
    </Dialog>
  );
}

/** Excel 附件的只读 HTML 表格预览：拉取文件 → exceljs 解析 → 渲染表格（支持多 sheet 切页、合并单元格）。 */
function XlsxTablePreview({ attachment }: { attachment: RdTaskProgressAttachment }) {
  const [sheets, setSheets] = useState<XlsxPreviewSheet[] | null>(null);
  const [active, setActive] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [retryKey, setRetryKey] = useState(0);

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
  }, [attachment, retryKey]);

  if (error) {
    return (
      <div className="mx-auto flex min-h-[52vh] max-w-lg flex-col items-center justify-center rounded-[8px] border border-dashed border-slate-300 bg-white px-8 text-center" role="alert">
        <FileText className="h-10 w-10 text-slate-300" />
        <div className="mt-4 text-balance text-sm font-semibold text-[#1b2559]">表格预览失败</div>
        <p className="mt-2 text-pretty text-xs leading-5 text-slate-500">{error}，可点右上角「下载」打开。</p>
        <button
          type="button"
          onClick={() => setRetryKey((current) => current + 1)}
          className="mt-4 inline-flex items-center gap-1.5 rounded-lg bg-[#002fa7] px-3 py-2 text-xs font-semibold text-white hover:bg-[#002581] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#002fa7]/30"
        >
          <RefreshCw className="size-3.5" aria-hidden="true" />
          重新解析
        </button>
      </div>
    );
  }
  if (!sheets) {
    return (
      <div className="flex min-h-[52vh] flex-col items-center justify-center gap-3 text-slate-500" role="status" aria-label="正在解析表格">
        <div className="w-full max-w-xl space-y-2 px-6">
          <div className="h-8 animate-pulse rounded-lg bg-slate-200 motion-reduce:animate-none" />
          <div className="h-44 animate-pulse rounded-lg bg-slate-100 motion-reduce:animate-none" />
        </div>
        <span className="text-xs">正在解析表格…</span>
      </div>
    );
  }
  if (sheets.length === 0 || sheets.every((s) => s.rowCount === 0)) {
    return (
      <div className="mx-auto flex min-h-[52vh] max-w-lg flex-col items-center justify-center rounded-[8px] border border-dashed border-slate-300 bg-white px-8 text-center">
        <Table2 className="h-10 w-10 text-slate-300" />
        <div className="mt-4 text-balance text-sm font-semibold text-[#1b2559]">这张表是空的</div>
        <p className="mt-2 text-pretty text-xs leading-5 text-slate-500">未读取到任何单元格内容。</p>
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
                "shrink-0 rounded-full px-2.5 py-1 text-xs font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#002fa7]/30",
                i === active ? "bg-white text-[#002fa7] shadow-sm" : "text-slate-500 hover:bg-white hover:text-slate-700",
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
  const sortedNotes = useMemo(
    () => [...notes].sort((a, b) => {
      const timeOrder = (b.created_at ?? "").localeCompare(a.created_at ?? "");
      return timeOrder || b.id.localeCompare(a.id);
    }),
    [notes],
  );
  if (loading) {
    return (
      <div className="space-y-2 rounded-[8px] border border-slate-200 bg-white p-3" role="status" aria-label={t("正在读取进度留痕")}>
        {[0, 1].map((item) => (
          <div key={item} className="space-y-2 rounded-lg border border-slate-100 p-3">
            <div className="h-3 w-32 animate-pulse rounded bg-slate-200 motion-reduce:animate-none" />
            <div className="h-12 animate-pulse rounded bg-slate-100 motion-reduce:animate-none" />
          </div>
        ))}
        <span className="sr-only">{t("正在读取进度留痕...")}</span>
      </div>
    );
  }

  if (notes.length === 0) {
    return (
      <div className="rounded-[8px] border border-dashed border-slate-200 bg-slate-50/70 px-4 py-6 text-center">
        <p className="text-balance text-sm font-semibold text-slate-600">{emptyText ?? t("暂无进度记录")}</p>
        <p className="mt-1 text-pretty text-xs leading-5 text-slate-400">{t("后续进展、结论和附件会按时间显示在这里。")}</p>
      </div>
    );
  }

  return (
    <TaskImageGalleryScope notes={sortedNotes}>
      <ul className="space-y-3">
        {sortedNotes.map((note) => (
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
              <span className="inline-flex items-center gap-1 rounded-full bg-[#eef3ff] px-2 py-0.5 text-[10px] font-semibold text-[#002fa7]">
                <Paperclip className="h-3 w-3" />
                {t("{n} 个附件", { n: note.attachments.length })}
              </span>
            )}
          </div>
          {note.text && (
            // 含 @ 提及的评论在中文态用高亮渲染（@姓名 蓝色）；英文态人名不参与翻译、
            // 高亮与整段自动翻译不可兼得，保持 AutoTranslatedText 原行为
            (note.mentions?.length ?? 0) > 0 && currentI18nLang() === "zh" ? (
              <p className={cn("mt-2 whitespace-pre-wrap break-words text-pretty text-slate-800", compact ? "text-xs leading-5" : "text-sm leading-relaxed")}>
                {renderTextWithMentions(note.text, note.mentions)}
              </p>
            ) : (
              <AutoTranslatedText
                as="p"
                text={note.text}
                className={cn("mt-2 whitespace-pre-wrap break-words text-pretty text-slate-800", compact ? "text-xs leading-5" : "text-sm leading-relaxed")}
              />
            )
          )}
          <ProgressAttachmentGrid attachments={note.attachments} compact={compact} imageDisplay="clipped-cards" className="mt-3" />
          </li>
        ))}
      </ul>
    </TaskImageGalleryScope>
  );
}
