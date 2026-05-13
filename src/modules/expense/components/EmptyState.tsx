import type { ElementType, ReactNode } from "react";
import { Inbox } from "lucide-react";

export function EmptyState({
  title = "暂无数据",
  detail,
  action,
  icon: Icon = Inbox,
  compact = false,
}: {
  title?: string;
  detail?: string;
  action?: ReactNode;
  icon?: ElementType;
  compact?: boolean;
}) {
  return (
    <div
      className={[
        "flex flex-col items-center justify-center rounded-[var(--m3-shape-large)] border border-dashed border-slate-200 bg-slate-50 px-4 text-center",
        compact ? "min-h-[148px] py-5" : "min-h-[220px] py-8",
      ].join(" ")}
    >
      <Icon className={compact ? "mb-2 h-6 w-6 text-slate-400" : "mb-3 h-8 w-8 text-slate-400"} />
      <div className="text-sm font-bold text-slate-800">{title}</div>
      {detail ? <div className="mt-1 max-w-[420px] text-xs leading-5 text-slate-500">{detail}</div> : null}
      {action ? <div className="mt-4 flex flex-wrap items-center justify-center gap-2">{action}</div> : null}
    </div>
  );
}
