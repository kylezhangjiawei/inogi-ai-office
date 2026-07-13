import React, { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { GripVertical, X } from "lucide-react";
import { cn } from "./ui/utils";

/** 抽屉默认（同时也是最小）宽度 */
const DRAWER_MIN_WIDTH = 640;

/**
 * 日报/月报详情右侧抽屉：替代就地内联展开——长报告在抽屉内部滚动，
 * 不再把驾驶舱页面撑长。tone 跟随面板品牌色（日报 violet / 月报 amber）。
 * 背景遮罩不加 backdrop-blur（全屏模糊每帧重栅格化会造成点击卡顿）。
 */
export function ReportDetailDrawer({
  onClose,
  userName,
  dateLabel,
  trigger,
  tone = "violet",
  headerExtra,
  children,
}: {
  onClose: () => void;
  userName: string;
  dateLabel: string;
  trigger?: string;
  tone?: "violet" | "amber";
  headerExtra?: React.ReactNode;
  children: React.ReactNode;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

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

  const avatarCls = tone === "amber" ? "bg-amber-100 text-amber-700" : "bg-violet-100 text-violet-700";

  // Portal 渲染到 body 最外层：面板内部祖先常带 transform / backdrop-filter，
  // 会把 fixed 的定位基准劫持成该祖先，导致抽屉浮在卡片里而非贴视口右缘。
  return createPortal(
    <div className="fixed inset-0 z-50 flex justify-end bg-slate-900/30" onClick={onClose}>
      <div
        className="relative flex h-full flex-col overflow-hidden border-l border-slate-100 bg-white shadow-[-12px_0_40px_rgba(15,23,42,0.12)] animate-in slide-in-from-right duration-300"
        style={{ width: `min(${width}px, 95vw)` }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* 左缘拖拽把手：按住向左拖加宽（最小 640px，最大 95vw） */}
        <div
          className="group absolute inset-y-0 left-0 z-10 flex w-3 cursor-ew-resize items-center justify-center hover:bg-slate-100/80"
          onPointerDown={onHandlePointerDown}
          onPointerMove={onHandlePointerMove}
          onPointerUp={onHandlePointerUp}
          title="拖拽调整宽度"
        >
          <span className="flex h-10 w-3 items-center justify-center rounded-r-md bg-slate-200/90 text-slate-500 transition-colors group-hover:bg-slate-300 group-hover:text-slate-700">
            <GripVertical className="h-3.5 w-3.5" />
          </span>
        </div>
        <div className="flex items-center gap-2.5 border-b border-slate-100 px-5 py-4">
          <span className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-sm font-bold", avatarCls)}>
            {userName.slice(0, 1)}
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="truncate text-sm font-semibold text-slate-800">{userName}</span>
              {trigger && (
                <span className="rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-500">
                  {trigger === "cron" ? "自动" : "手动"}
                </span>
              )}
            </div>
            <div className="mt-0.5 text-xs tabular-nums text-slate-400">{dateLabel}</div>
          </div>
          {headerExtra}
          <button
            type="button"
            onClick={onClose}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600"
            title="关闭"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-4">{children}</div>
      </div>
    </div>,
    document.body,
  );
}