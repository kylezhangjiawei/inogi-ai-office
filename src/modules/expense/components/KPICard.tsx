import type { LucideIcon } from "lucide-react";

import { Progress } from "../../../app/components/ui/progress";
import { cn } from "../../../app/components/ui/utils";

type KPICardProps = {
  title: string;
  value: string;
  icon: LucideIcon;
  trend?: string;
  badge?: string;
  progress?: number;
  onClick?: () => void;
};

export function KPICard({ title, value, icon: Icon, trend, badge, progress, onClick }: KPICardProps) {
  const Comp = onClick ? "button" : "div";

  return (
    <Comp
      type={onClick ? "button" : undefined}
      onClick={onClick}
      className={cn(
        "material-panel flex h-full min-h-[120px] w-full flex-col justify-between rounded-[4px] px-4 py-3 text-left",
        onClick ? "cursor-pointer transition-colors hover:border-[#8fa8df] hover:bg-[#f8faff] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#002fa7]/25" : "",
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate text-xs font-semibold text-slate-500">{title}</div>
          <div className="mt-1 truncate text-2xl font-bold text-slate-950">{value}</div>
        </div>
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[4px] border border-[#b8c8ec] bg-[#eef3ff] text-[#002fa7]">
          <Icon className="h-4 w-4" aria-hidden="true" />
        </div>
      </div>
      <div className="mt-3 flex min-h-[22px] items-end">
        {progress !== undefined ? (
          <Progress value={progress} className="mb-1 h-1.5 max-w-[96px]" />
        ) : badge ? (
          <span className="inline-flex rounded-full border border-amber-100 bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-700">
            {badge}
          </span>
        ) : trend ? (
          <div className="truncate text-xs font-medium text-[#002fa7]">{trend}</div>
        ) : (
          <span className="h-[1px]" />
        )}
      </div>
    </Comp>
  );
}
