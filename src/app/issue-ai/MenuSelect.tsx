/**
 * MenuSelect —— 自包含的下拉选择（不依赖任何 Radix 浮层）。
 *
 * 为什么自己写：项目 CSS 庞大,任何 Radix 浮层(Select/DropdownMenu/Popover)打开时其
 * scroll-lock(react-remove-scroll-bar)都会注入一个 <style> → 强制整页 re-cascade ~24ms → 卡顿,
 * 且无法在保留 Radix 的前提下绕过(实测:改选择器/常驻 scroll-bar/modal=false 均无效)。
 * 这里用 button + 绝对定位列表 + 手写键盘/点外关闭实现,打开**零 <style> 注入、零 re-cascade**,
 * 视觉与交互(描边/箭头/选中态/勾选/↑↓选择/Enter/Esc/点外关闭/ARIA listbox)与 Radix 一致。
 */
import * as React from "react";
import { Check, ChevronDown } from "lucide-react";

import { cn } from "../components/ui/utils";
import { t } from "../lib/i18n";

const ALL = "__all__";

export type MenuSelectOption<T extends string> = { value: T; label: string };

export function MenuSelect<T extends string>({
  value,
  onChange,
  options,
  placeholder,
  allLabel,
  triggerClassName,
  align = "start",
}: {
  value: T | undefined;
  onChange: (v: T | undefined) => void;
  options: MenuSelectOption<T>[];
  /** 未选中时触发器显示的占位（无 allLabel 时用）。 */
  placeholder?: string;
  /** 给了就在最上面渲染一个「全部」项，选它=清空(onChange undefined)；不给=必选。 */
  allLabel?: string;
  triggerClassName?: string;
  align?: "start" | "end";
}) {
  const [open, setOpen] = React.useState(false);
  const [activeIdx, setActiveIdx] = React.useState(-1);
  const rootRef = React.useRef<HTMLDivElement>(null);
  const listRef = React.useRef<HTMLDivElement>(null);

  const items = React.useMemo<Array<{ value: string; label: string }>>(
    () => (allLabel != null ? [{ value: ALL, label: allLabel }, ...options] : options),
    [allLabel, options],
  );
  const curIdx = items.findIndex((i) => i.value === (value ?? ALL));
  const selected = options.find((o) => o.value === value);
  const active = value !== undefined;
  const display = selected ? selected.label : allLabel ?? placeholder ?? "请选择";

  // 点击外部关闭
  React.useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onDown, true);
    return () => document.removeEventListener("pointerdown", onDown, true);
  }, [open]);

  // 打开时高亮当前项
  React.useEffect(() => {
    if (open) setActiveIdx(curIdx >= 0 ? curIdx : 0);
    // 仅在 open 变化时重置；curIdx 不进依赖以免选中后跳动
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // 高亮项滚动到可见
  React.useEffect(() => {
    if (open && activeIdx >= 0) {
      (listRef.current?.children[activeIdx] as HTMLElement | undefined)?.scrollIntoView({ block: "nearest" });
    }
  }, [open, activeIdx]);

  function choose(v: string) {
    onChange(v === ALL ? undefined : (v as T));
    setOpen(false);
  }

  function onKeyDown(e: React.KeyboardEvent) {
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        if (!open) setOpen(true);
        else setActiveIdx((i) => Math.min((i < 0 ? curIdx : i) + 1, items.length - 1));
        break;
      case "ArrowUp":
        e.preventDefault();
        if (!open) setOpen(true);
        else setActiveIdx((i) => Math.max((i < 0 ? curIdx : i) - 1, 0));
        break;
      case "Home":
        if (open) { e.preventDefault(); setActiveIdx(0); }
        break;
      case "End":
        if (open) { e.preventDefault(); setActiveIdx(items.length - 1); }
        break;
      case "Enter":
      case " ":
        e.preventDefault();
        if (!open) setOpen(true);
        else if (activeIdx >= 0) choose(items[activeIdx].value);
        break;
      case "Escape":
        if (open) { e.preventDefault(); setOpen(false); }
        break;
      case "Tab":
        setOpen(false);
        break;
    }
  }

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        onKeyDown={onKeyDown}
        aria-haspopup="listbox"
        aria-expanded={open}
        data-state={open ? "open" : "closed"}
        className={cn(
          "inline-flex h-9 w-[9.5rem] items-center justify-between gap-2 rounded-lg border px-3 text-xs shadow-sm transition-colors outline-none",
          "focus-visible:ring-2 focus-visible:ring-[#002fa7]/30 data-[state=open]:ring-2 data-[state=open]:ring-[#002fa7]/25",
          active
            ? "border-[#002fa7]/30 bg-[#eef3ff] font-medium text-[#002fa7]"
            : "border-slate-300 bg-white text-slate-600 hover:border-[#002fa7]/30 hover:bg-[#eef3ff]",
          triggerClassName,
        )}
      >
        <span className="truncate">{t(display)}</span>
        <ChevronDown className={cn("size-3.5 shrink-0 opacity-60 transition-transform", open && "rotate-180")} />
      </button>
      {open ? (
        <div
          ref={listRef}
          role="listbox"
          className={cn(
            "absolute top-full z-50 mt-1 max-h-64 min-w-full overflow-y-auto rounded-lg border border-slate-200 bg-white p-1 text-xs shadow-lg",
            align === "end" ? "right-0" : "left-0",
            "animate-in fade-in-0 zoom-in-95 duration-100",
          )}
        >
          {items.map((it, idx) => {
            const isSel = it.value === (value ?? ALL);
            return (
              <button
                key={it.value}
                type="button"
                role="option"
                aria-selected={isSel}
                onClick={() => choose(it.value)}
                onMouseEnter={() => setActiveIdx(idx)}
                className={cn(
                  "relative flex w-full cursor-pointer select-none items-center rounded-md py-1.5 pl-7 pr-3 text-left outline-none transition-colors",
                  idx === activeIdx
                    ? "bg-[#eef3ff] text-[#002fa7]"
                    : "text-slate-700",
                )}
              >
                {isSel ? (
                  <Check className="absolute left-2 size-3.5 text-[#002fa7]" />
                ) : null}
                {t(it.label)}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
