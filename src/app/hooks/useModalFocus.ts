import { useEffect, useRef } from "react";

const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

function focusableElements(container: HTMLElement) {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR))
    .filter((element) => !element.hidden && element.getAttribute("aria-hidden") !== "true");
}

/**
 * 为项目中的大型自定义弹窗补齐焦点接管、Tab 循环、Escape 关闭和焦点恢复。
 * 视觉布局保持原样，仅约束键盘和辅助技术的交互范围。
 */
export function useModalFocus<T extends HTMLElement>(
  open: boolean,
  onClose: () => void,
  options: { escapeDisabled?: boolean } = {},
) {
  const containerRef = useRef<T>(null);
  const onCloseRef = useRef(onClose);
  const escapeDisabledRef = useRef(options.escapeDisabled);

  useEffect(() => {
    onCloseRef.current = onClose;
    escapeDisabledRef.current = options.escapeDisabled;
  }, [onClose, options.escapeDisabled]);

  useEffect(() => {
    if (!open) return;
    const container = containerRef.current;
    if (!container) return;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;

    const frame = window.requestAnimationFrame(() => {
      const preferred = container.querySelector<HTMLElement>("[data-dialog-autofocus]");
      const target = preferred ?? focusableElements(container)[0] ?? container;
      target.focus();
    });

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !escapeDisabledRef.current) {
        event.preventDefault();
        onCloseRef.current();
        return;
      }
      if (event.key !== "Tab") return;

      const focusable = focusableElements(container);
      if (!focusable.length) {
        event.preventDefault();
        container.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;
      if (!container.contains(active)) {
        event.preventDefault();
        first.focus();
      } else if (event.shiftKey && active === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", handleKeyDown, true);
    return () => {
      window.cancelAnimationFrame(frame);
      document.removeEventListener("keydown", handleKeyDown, true);
      if (previousFocus?.isConnected) previousFocus.focus();
    };
  }, [open]);

  return containerRef;
}
