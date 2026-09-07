import React, { useRef, useState } from "react";
import { GripVertical, X } from "lucide-react";
import { cn } from "./ui/utils";
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetTitle,
} from "./ui/sheet";

/** 抽屉默认（同时也是最小）宽度 */
const DRAWER_MIN_WIDTH = 640;

/**
 * 日报/月报详情右侧抽屉：替代就地内联展开——长报告在抽屉内部滚动，
 * 不再把驾驶舱页面撑长。tone 保留旧调用兼容，视觉统一使用 Horizon 主题。
 * 背景遮罩不使用全屏模糊（避免每帧重栅格化造成点击卡顿）。
 */
export function ReportDetailDrawer({
  onClose,
  userName,
  dateLabel,
  trigger,
  tone = "blue",
  headerExtra,
  children,
}: {
  onClose: () => void;
  userName: string;
  dateLabel: string;
  trigger?: string;
  tone?: "blue" | "violet" | "amber";
  headerExtra?: React.ReactNode;
  children: React.ReactNode;
}) {
  // 左缘把手拖拽调宽：向左拖变宽，最小为默认宽度，最大不超过视口 95%
  const [width, setWidth] = useState(DRAWER_MIN_WIDTH);
  const dragRef = useRef<{ startX: number; startWidth: number } | null>(null);
  const onHandlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    dragRef.current = { startX: e.clientX, startWidth: width };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onHandlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag) return;
    const max = Math.floor(window.innerWidth * 0.95);
    setWidth(Math.min(max, Math.max(DRAWER_MIN_WIDTH, drag.startWidth + (drag.startX - e.clientX))));
  };
  const onHandlePointerUp = () => {
    dragRef.current = null;
  };

  void tone;
  const avatarCls = "bg-accent text-primary";

  return (
    <Sheet open onOpenChange={(nextOpen) => { if (!nextOpen) onClose(); }}>
      <SheetContent
        side="right"
        className="horizon-portal horizon-theme gap-0 overflow-hidden border-l border-slate-200 bg-white p-0 shadow-xl sm:max-w-none [&>button.absolute]:hidden"
        style={{ width: `min(${width}px, 95vw)` }}
      >
        {/* 左缘拖拽把手：按住向左拖加宽（最小 640px，最大 95vw） */}
        <div
          className="group absolute inset-y-0 left-0 z-10 flex w-3 cursor-ew-resize items-center justify-center hover:bg-slate-100/80"
          onPointerDown={onHandlePointerDown}
          onPointerMove={onHandlePointerMove}
          onPointerUp={onHandlePointerUp}
          onPointerCancel={onHandlePointerUp}
          title="拖拽调整宽度"
          role="separator"
          aria-label="拖拽调整报告详情宽度"
          aria-orientation="vertical"
        >
          <span className="flex h-10 w-3 items-center justify-center rounded-r-md bg-slate-200/90 text-slate-500 transition-colors group-hover:bg-slate-300 group-hover:text-slate-700">
            <GripVertical className="size-3.5" aria-hidden="true" />
          </span>
        </div>
        <div className="flex items-center gap-2.5 border-b border-slate-100 px-5 py-4">
          <span className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-sm font-bold", avatarCls)}>
            {userName.slice(0, 1)}
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <SheetTitle className="truncate text-sm font-semibold text-slate-800">{userName}</SheetTitle>
              {trigger && (
                <span className="rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-500">
                  {trigger === "cron" ? "自动" : "手动"}
                </span>
              )}
            </div>
            <SheetDescription className="mt-0.5 text-xs tabular-nums text-slate-400">{dateLabel}</SheetDescription>
          </div>
          {headerExtra}
          <SheetClose asChild>
            <button
              type="button"
              aria-label="关闭报告详情"
              className="flex size-8 shrink-0 items-center justify-center rounded-[4px] text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/25"
              title="关闭报告详情"
            >
              <X className="size-4" aria-hidden="true" />
            </button>
          </SheetClose>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-4">{children}</div>
      </SheetContent>
    </Sheet>
  );
}
