import { useLayoutEffect, useRef, type RefObject } from "react";

/** Reset the shared desktop content viewport when a route-level page mounts. */
export function useResetPageScroll<T extends HTMLElement>(): RefObject<T> {
  const pageRef = useRef<T>(null);

  useLayoutEffect(() => {
    const scrollContainer = pageRef.current?.parentElement?.closest("main");
    if (scrollContainer) {
      scrollContainer.scrollTo({ top: 0, left: 0, behavior: "auto" });
      return;
    }
    window.scrollTo({ top: 0, left: 0, behavior: "auto" });
  }, []);

  return pageRef;
}
