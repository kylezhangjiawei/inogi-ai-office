import { useEffect } from "react";

const MOBILE_OVERLAY_STATE_KEY = "__inogiMobileOverlay";

/**
 * Lock the document behind a full-screen mobile overlay without losing its
 * scroll position. `overflow: hidden` alone is not reliable on iOS Safari.
 */
export function useBodyScrollLock(active = true) {
  useEffect(() => {
    if (!active) return undefined;

    const body = document.body;
    const root = document.documentElement;
    const scrollY = window.scrollY;
    const previous = {
      bodyPosition: body.style.position,
      bodyTop: body.style.top,
      bodyWidth: body.style.width,
      bodyOverflow: body.style.overflow,
      rootOverscrollBehavior: root.style.overscrollBehavior,
    };

    body.style.position = "fixed";
    body.style.top = `-${scrollY}px`;
    body.style.width = "100%";
    body.style.overflow = "hidden";
    root.style.overscrollBehavior = "none";

    return () => {
      body.style.position = previous.bodyPosition;
      body.style.top = previous.bodyTop;
      body.style.width = previous.bodyWidth;
      body.style.overflow = previous.bodyOverflow;
      root.style.overscrollBehavior = previous.rootOverscrollBehavior;
      window.scrollTo(0, scrollY);
    };
  }, [active]);
}

export function pushMobileOverlayState(marker: string): boolean {
  if (!document.documentElement.classList.contains("mobile-route")) return false;
  if (window.history.state?.[MOBILE_OVERLAY_STATE_KEY] === marker) return true;
  window.history.pushState(
    { ...(window.history.state ?? {}), [MOBILE_OVERLAY_STATE_KEY]: marker },
    "",
  );
  return true;
}

export function isCurrentMobileOverlay(marker: string): boolean {
  return window.history.state?.[MOBILE_OVERLAY_STATE_KEY] === marker;
}

export function closeMobileOverlay(marker: string, fallback: () => void) {
  if (isCurrentMobileOverlay(marker)) window.history.back();
  else fallback();
}

/** A browser/system Back action closes the active overlay before leaving the page. */
export function useMobileOverlayBack(active: boolean, marker: string, onBack: () => void) {
  useEffect(() => {
    if (!active || !document.documentElement.classList.contains("mobile-route")) return undefined;
    const handlePopState = () => {
      // A nested overlay may have been popped back to this overlay's own entry.
      if (!isCurrentMobileOverlay(marker)) onBack();
    };
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, [active, marker, onBack]);
}
