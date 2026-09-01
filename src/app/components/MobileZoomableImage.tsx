import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { Download, X, ZoomIn, ZoomOut } from "lucide-react";
import { cn } from "./ui/utils";
import { isMobileViewport } from "../lib/mobileRouting";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "./ui/dialog";
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
} from "../lib/taskImageGesture";

type MobileZoomableImageProps = {
  src: string;
  alt: string;
  className?: string;
  imageClassName?: string;
  controlsClassName?: string;
  loading?: "eager" | "lazy";
  decoding?: "async" | "auto" | "sync";
  showControls?: boolean;
  enabled?: boolean;
  stopPropagation?: boolean;
  onLoad?: React.ReactEventHandler<HTMLImageElement>;
};

const IMAGE_FILE_EXTENSION = /\.(?:avif|bmp|gif|heic|heif|jpe?g|png|svg|webp)(?:[?#]|$)/i;
const MOBILE_IMAGE_PREVIEW_HISTORY_KEY = "__inogiImagePreview";
let nextMobileImagePreviewOwner = 1;

export function isImagePreviewSource(mimeType?: string, ...candidates: Array<string | undefined>) {
  if (mimeType?.toLowerCase().startsWith("image/")) return true;
  return candidates.some((candidate) => candidate != null && IMAGE_FILE_EXTENSION.test(candidate));
}

function isMobileImageZoomContext(): boolean {
  return isMobileViewport()
    || (typeof document !== "undefined" && document.documentElement.classList.contains("mobile-route"));
}

const mobileZoomSubscribers = new Set<() => void>();
let mobileZoomRouteObserver: MutationObserver | null = null;

function emitMobileZoomContextChange() {
  mobileZoomSubscribers.forEach((subscriber) => subscriber());
}

function subscribeMobileZoomContext(subscriber: () => void) {
  if (typeof window === "undefined") return () => undefined;

  mobileZoomSubscribers.add(subscriber);
  if (mobileZoomSubscribers.size === 1) {
    window.addEventListener("resize", emitMobileZoomContextChange);
    window.addEventListener("orientationchange", emitMobileZoomContextChange);
    if (typeof MutationObserver !== "undefined") {
      mobileZoomRouteObserver = new MutationObserver(emitMobileZoomContextChange);
      mobileZoomRouteObserver.observe(document.documentElement, {
        attributes: true,
        attributeFilter: ["class"],
      });
    }
  }

  return () => {
    mobileZoomSubscribers.delete(subscriber);
    if (mobileZoomSubscribers.size === 0) {
      window.removeEventListener("resize", emitMobileZoomContextChange);
      window.removeEventListener("orientationchange", emitMobileZoomContextChange);
      mobileZoomRouteObserver?.disconnect();
      mobileZoomRouteObserver = null;
    }
  };
}

function useMobileZoomEnabled(enabled?: boolean): boolean {
  const mobile = useSyncExternalStore(
    subscribeMobileZoomContext,
    isMobileImageZoomContext,
    () => false,
  );
  return enabled ?? mobile;
}

/**
 * Shared image surface for every in-app preview. On phone-sized viewports it
 * adds pinch zoom, pan, double-tap zoom and explicit controls. Desktop keeps
 * the caller's existing layout without intercepting pointer gestures.
 */
export function MobileZoomableImage({
  src,
  alt,
  className,
  imageClassName,
  controlsClassName,
  loading = "eager",
  decoding = "async",
  showControls = true,
  enabled,
  stopPropagation = true,
  onLoad,
}: MobileZoomableImageProps) {
  const zoomEnabled = useMobileZoomEnabled(enabled);
  const viewportRef = useRef<HTMLDivElement>(null);
  const imageFrameRef = useRef<HTMLDivElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);
  const zoomLabelRef = useRef<HTMLSpanElement>(null);
  const activePointersRef = useRef(new Map<number, PointerPosition>());
  const layoutRef = useRef<(TaskImageViewport & { center: PointerPosition }) | null>(null);
  const transformRef = useRef<TaskImageTransform>({ scale: TASK_IMAGE_MIN_SCALE, x: 0, y: 0 });
  const startTransformRef = useRef<TaskImageTransform>({ scale: TASK_IMAGE_MIN_SCALE, x: 0, y: 0 });
  const startPointerRef = useRef<PointerPosition | null>(null);
  const pinchDistanceRef = useRef<number | null>(null);
  const pinchMidpointRef = useRef<PointerPosition | null>(null);
  const draggedRef = useRef(false);
  const multitouchRef = useRef(false);
  const lastPointerTypeRef = useRef("");
  const lastTapRef = useRef<{ at: number; point: PointerPosition } | null>(null);
  const pendingTransformRef = useRef<TaskImageTransform | null>(null);
  const transformFrameRef = useRef<number | null>(null);

  const measureLayout = useCallback(() => {
    const viewport = viewportRef.current;
    if (!viewport) return null;
    const rect = viewport.getBoundingClientRect();
    const image = imageRef.current;
    const layout = {
      width: viewport.clientWidth,
      height: viewport.clientHeight,
      imageWidth: image?.offsetWidth || viewport.clientWidth,
      imageHeight: image?.offsetHeight || viewport.clientHeight,
      center: { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 },
    };
    layoutRef.current = layout;
    return layout;
  }, []);

  const applyTransform = useCallback((next: TaskImageTransform, animate: boolean) => {
    const frame = imageFrameRef.current;
    const layout = layoutRef.current ?? measureLayout();
    if (!frame || !layout) return transformRef.current;
    const normalized = clampTaskImageTransform(next, layout);
    transformRef.current = normalized;
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    frame.style.transition = animate && !reduceMotion ? "transform 180ms ease-out" : "none";
    frame.style.transform = `translate3d(${normalized.x}px, ${normalized.y}px, 0) scale(${normalized.scale})`;
    if (zoomLabelRef.current) zoomLabelRef.current.textContent = `${Math.round(normalized.scale * 100)}%`;
    return normalized;
  }, [measureLayout]);

  const scheduleTransform = useCallback((next: TaskImageTransform) => {
    pendingTransformRef.current = next;
    if (transformFrameRef.current != null) return;
    transformFrameRef.current = window.requestAnimationFrame(() => {
      transformFrameRef.current = null;
      const pending = pendingTransformRef.current;
      pendingTransformRef.current = null;
      if (pending) applyTransform(pending, false);
    });
  }, [applyTransform]);

  const flushTransform = useCallback(() => {
    if (transformFrameRef.current != null) {
      window.cancelAnimationFrame(transformFrameRef.current);
      transformFrameRef.current = null;
    }
    const pending = pendingTransformRef.current;
    pendingTransformRef.current = null;
    if (pending) applyTransform(pending, false);
  }, [applyTransform]);

  const resetTransform = useCallback((animate: boolean) => {
    activePointersRef.current.clear();
    startPointerRef.current = null;
    pinchDistanceRef.current = null;
    pinchMidpointRef.current = null;
    draggedRef.current = false;
    multitouchRef.current = false;
    lastTapRef.current = null;
    return applyTransform({ scale: TASK_IMAGE_MIN_SCALE, x: 0, y: 0 }, animate);
  }, [applyTransform]);

  const zoomTo = useCallback((requestedScale: number, focus?: PointerPosition, animate = true) => {
    const current = transformRef.current;
    const layout = layoutRef.current ?? measureLayout();
    if (!layout || !focus) return applyTransform({ ...current, scale: requestedScale }, animate);
    return applyTransform(zoomTaskImageTransform(current, requestedScale, focus, layout.center), animate);
  }, [applyTransform, measureLayout]);

  const toggleZoomAt = useCallback((focus: PointerPosition) => {
    const nextScale = transformRef.current.scale > TASK_IMAGE_MIN_SCALE
      ? TASK_IMAGE_MIN_SCALE
      : TASK_IMAGE_DOUBLE_TAP_SCALE;
    zoomTo(nextScale, focus);
  }, [zoomTo]);

  const finishPointer = useCallback((event: React.PointerEvent<HTMLDivElement>, cancelled = false) => {
    if (!activePointersRef.current.has(event.pointerId)) return;
    flushTransform();
    const wasDragged = draggedRef.current;
    const wasMultitouch = multitouchRef.current;
    activePointersRef.current.delete(event.pointerId);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }

    if (activePointersRef.current.size > 0) {
      const remaining = Array.from(activePointersRef.current.values());
      startPointerRef.current = remaining[0] ?? null;
      startTransformRef.current = { ...transformRef.current };
      pinchDistanceRef.current = remaining.length >= 2
        ? distanceBetweenPointers(remaining[0], remaining[1])
        : null;
      pinchMidpointRef.current = remaining.length >= 2
        ? midpointBetweenPointers(remaining[0], remaining[1])
        : null;
      return;
    }

    if (!cancelled && event.pointerType !== "mouse" && !wasDragged && !wasMultitouch) {
      const point = { x: event.clientX, y: event.clientY };
      const previous = lastTapRef.current;
      const now = Date.now();
      if (previous && now - previous.at <= 320 && distanceBetweenPointers(previous.point, point) <= 28) {
        lastTapRef.current = null;
        toggleZoomAt(point);
      } else {
        lastTapRef.current = { at: now, point };
      }
    }

    startPointerRef.current = null;
    pinchDistanceRef.current = null;
    pinchMidpointRef.current = null;
    draggedRef.current = false;
    multitouchRef.current = false;
  }, [flushTransform, toggleZoomAt]);

  useLayoutEffect(() => {
    flushTransform();
    measureLayout();
    resetTransform(false);
  }, [flushTransform, measureLayout, resetTransform, src, zoomEnabled]);

  useLayoutEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return undefined;
    const update = () => {
      measureLayout();
      applyTransform(transformRef.current, false);
    };
    update();
    if (typeof ResizeObserver === "undefined") return undefined;
    const observer = new ResizeObserver(update);
    observer.observe(viewport);
    if (imageRef.current) observer.observe(imageRef.current);
    return () => observer.disconnect();
  }, [applyTransform, measureLayout, src]);

  useEffect(() => () => {
    if (transformFrameRef.current != null) window.cancelAnimationFrame(transformFrameRef.current);
  }, []);

  return (
    <div
      ref={viewportRef}
      className={cn(
        "relative flex min-h-0 min-w-0 items-center justify-center overflow-hidden",
        zoomEnabled && "touch-none select-none",
        className,
      )}
      aria-label={zoomEnabled ? "图片手势区域，可双指缩放，放大后拖动" : undefined}
      onClick={(event) => {
        if (stopPropagation || zoomEnabled) event.stopPropagation();
      }}
      onPointerDown={zoomEnabled ? (event) => {
        if (event.pointerType === "mouse" && event.button !== 0) return;
        if (event.target instanceof Element && event.target.closest("button, a")) return;
        const point = { x: event.clientX, y: event.clientY };
        lastPointerTypeRef.current = event.pointerType;
        measureLayout();
        activePointersRef.current.set(event.pointerId, point);
        event.currentTarget.setPointerCapture(event.pointerId);
        if (activePointersRef.current.size === 1) {
          startPointerRef.current = point;
          startTransformRef.current = { ...transformRef.current };
          draggedRef.current = false;
          return;
        }
        const [first, second] = Array.from(activePointersRef.current.values());
        multitouchRef.current = true;
        draggedRef.current = true;
        pinchDistanceRef.current = distanceBetweenPointers(first, second);
        pinchMidpointRef.current = midpointBetweenPointers(first, second);
        startTransformRef.current = { ...transformRef.current };
      } : undefined}
      onPointerMove={zoomEnabled ? (event) => {
        if (!activePointersRef.current.has(event.pointerId)) return;
        activePointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
        const points = Array.from(activePointersRef.current.values());
        if (points.length >= 2) {
          const [first, second] = points;
          const startDistance = pinchDistanceRef.current || distanceBetweenPointers(first, second);
          const startMidpoint = pinchMidpointRef.current || midpointBetweenPointers(first, second);
          scheduleTransform(pinchTaskImageTransform({
            startTransform: startTransformRef.current,
            startDistance,
            currentDistance: distanceBetweenPointers(first, second),
            startMidpoint,
            currentMidpoint: midpointBetweenPointers(first, second),
            viewportCenter: layoutRef.current?.center ?? { x: 0, y: 0 },
          }));
          return;
        }
        const start = startPointerRef.current;
        if (!start) return;
        const deltaX = event.clientX - start.x;
        const deltaY = event.clientY - start.y;
        if (Math.hypot(deltaX, deltaY) > 6) draggedRef.current = true;
        if (transformRef.current.scale <= TASK_IMAGE_MIN_SCALE) return;
        const initial = startTransformRef.current;
        scheduleTransform({ ...initial, x: initial.x + deltaX, y: initial.y + deltaY });
      } : undefined}
      onPointerUp={zoomEnabled ? finishPointer : undefined}
      onPointerCancel={zoomEnabled ? (event) => finishPointer(event, true) : undefined}
      onLostPointerCapture={zoomEnabled ? (event) => finishPointer(event, true) : undefined}
      onDoubleClick={zoomEnabled ? (event) => {
        if (lastPointerTypeRef.current === "touch") return;
        toggleZoomAt({ x: event.clientX, y: event.clientY });
      } : undefined}
    >
      <div ref={imageFrameRef} className="flex h-full w-full origin-center items-center justify-center will-change-transform">
        <img
          ref={imageRef}
          src={src}
          alt={alt}
          loading={loading}
          decoding={decoding}
          draggable={false}
          onClick={(event) => event.stopPropagation()}
          onLoad={(event) => {
            measureLayout();
            applyTransform(transformRef.current, false);
            onLoad?.(event);
          }}
          className={cn("max-h-full max-w-full object-contain", imageClassName)}
        />
      </div>

      {zoomEnabled && showControls ? (
        <div
          className={cn(
            "absolute bottom-3 left-1/2 z-20 flex -translate-x-1/2 items-center gap-1 rounded-full border border-white/15 bg-slate-950/90 p-1 text-white shadow-lg",
            controlsClassName,
          )}
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => event.stopPropagation()}
        >
          <button
            type="button"
            onClick={() => zoomTo(transformRef.current.scale - TASK_IMAGE_ZOOM_STEP)}
            className="flex h-11 w-11 items-center justify-center rounded-full transition active:bg-white/20"
            aria-label="缩小图片"
            title="缩小图片"
          >
            <ZoomOut className="h-4 w-4" aria-hidden="true" />
          </button>
          <span ref={zoomLabelRef} className="w-11 text-center text-[11px] tabular-nums text-white/85" aria-live="polite">100%</span>
          <button
            type="button"
            onClick={() => zoomTo(transformRef.current.scale + TASK_IMAGE_ZOOM_STEP)}
            className="flex h-11 w-11 items-center justify-center rounded-full transition active:bg-white/20"
            aria-label="放大图片"
            title="放大图片"
          >
            <ZoomIn className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
      ) : null}
    </div>
  );
}

export function MobileImageLightbox({
  src,
  alt,
  title,
  downloadUrl,
  onClose,
}: {
  src: string;
  alt: string;
  title?: string;
  downloadUrl?: string;
  onClose: () => void;
}) {
  const closingRef = useRef(false);
  const historyOwnerRef = useRef<string | null>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  const close = useCallback(() => {
    if (closingRef.current) return;
    closingRef.current = true;
    if (historyOwnerRef.current === window.history.state?.[MOBILE_IMAGE_PREVIEW_HISTORY_KEY]) window.history.back();
    else onCloseRef.current();
  }, []);
  useEffect(() => {
    const owner = historyOwnerRef.current ?? `image-preview-${nextMobileImagePreviewOwner++}`;
    historyOwnerRef.current = owner;
    if (window.history.state?.[MOBILE_IMAGE_PREVIEW_HISTORY_KEY] !== owner) {
      window.history.pushState(
        { ...(window.history.state ?? {}), [MOBILE_IMAGE_PREVIEW_HISTORY_KEY]: owner },
        "",
      );
    }
    const closeOnBack = () => {
      if (window.history.state?.[MOBILE_IMAGE_PREVIEW_HISTORY_KEY] !== owner) onCloseRef.current();
    };
    window.addEventListener("popstate", closeOnBack);
    return () => window.removeEventListener("popstate", closeOnBack);
  }, []);

  return (
    <Dialog open onOpenChange={(nextOpen) => { if (!nextOpen) close(); }}>
      <DialogContent className="horizon-theme horizon-portal inset-0 left-0 top-0 z-[1600] flex h-[100dvh] w-screen max-w-none translate-x-0 translate-y-0 flex-col gap-0 overscroll-none rounded-none border-0 bg-slate-950 p-0 shadow-none sm:max-w-none [&>button.absolute]:hidden">
      <div className="flex shrink-0 items-center justify-between gap-3 px-4 pb-3 pt-[max(0.75rem,env(safe-area-inset-top))] text-white">
        <div className="min-w-0">
          <DialogTitle className="truncate text-sm font-semibold text-white">{title || alt}</DialogTitle>
          <DialogDescription className="sr-only">支持双指缩放、放大后拖动与双击缩放的图片预览</DialogDescription>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {downloadUrl ? (
            <a
              href={downloadUrl}
              download={title || alt}
              target="_blank"
              rel="noopener noreferrer"
              className="flex h-11 w-11 items-center justify-center rounded-full bg-white/10 text-white/90"
              aria-label="下载原图"
              title="下载原图"
            >
              <Download className="h-4 w-4" aria-hidden="true" />
            </a>
          ) : null}
          <DialogClose asChild>
            <button
              type="button"
              autoFocus
              className="flex h-11 w-11 items-center justify-center rounded-full bg-white/10 text-white/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70"
              aria-label="关闭图片预览"
              title="关闭图片预览"
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
          </DialogClose>
        </div>
      </div>
      <MobileZoomableImage
        src={src}
        alt={alt}
        className="min-h-0 flex-1 px-2 pb-[max(1rem,env(safe-area-inset-bottom))]"
        imageClassName="rounded-[4px] shadow-lg"
      />
      </DialogContent>
    </Dialog>
  );
}

/** Desktop keeps opening the original URL in a new tab; mobile uses the shared zoom lightbox. */
export function MobileImagePreviewLink({
  src,
  alt,
  title,
  className,
  children,
  downloadUrl,
  openOnDesktop = true,
  onClick,
}: {
  src: string;
  alt: string;
  title?: string;
  className?: string;
  children: React.ReactNode;
  downloadUrl?: string;
  openOnDesktop?: boolean;
  onClick?: React.MouseEventHandler<HTMLAnchorElement>;
}) {
  const mobile = useMobileZoomEnabled();
  const [open, setOpen] = useState(false);

  return (
    <>
      <a
        href={openOnDesktop ? src : undefined}
        target={openOnDesktop ? "_blank" : undefined}
        rel={openOnDesktop ? "noopener noreferrer" : undefined}
        role={openOnDesktop ? undefined : "button"}
        tabIndex={openOnDesktop ? undefined : 0}
        className={className}
        title={title}
        data-mobile-image-preview="true"
        onClick={(event) => {
          onClick?.(event);
          if (event.defaultPrevented) return;
          if (!mobile) {
            if (!openOnDesktop) event.preventDefault();
            return;
          }
          event.preventDefault();
          event.stopPropagation();
          setOpen(true);
        }}
        onKeyDown={(event) => {
          if (!openOnDesktop && (event.key === "Enter" || event.key === " ")) {
            event.preventDefault();
            event.currentTarget.click();
          }
        }}
      >
        {children}
      </a>
      {open ? (
        <MobileImageLightbox
          src={src}
          alt={alt}
          title={title}
          downloadUrl={downloadUrl ?? src}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </>
  );
}
