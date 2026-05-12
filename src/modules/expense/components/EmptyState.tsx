import { Inbox } from "lucide-react";

export function EmptyState({ title = "暂无数据", detail }: { title?: string; detail?: string }) {
  return (
    <div className="flex min-h-[220px] flex-col items-center justify-center rounded-[var(--m3-shape-large)] border border-dashed border-slate-200 bg-slate-50 text-center">
      <Inbox className="mb-3 h-8 w-8 text-slate-400" />
      <div className="text-sm font-bold text-slate-800">{title}</div>
      {detail ? <div className="mt-1 text-xs text-slate-500">{detail}</div> : null}
    </div>
  );
}
