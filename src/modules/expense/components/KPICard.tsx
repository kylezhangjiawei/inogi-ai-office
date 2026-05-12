import type { LucideIcon } from "lucide-react";
import { motion } from "motion/react";

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
    <motion.div className="h-full" whileHover={{ y: onClick ? -3 : -1 }} transition={{ duration: 0.18 }}>
    <Comp
      type={onClick ? "button" : undefined}
      onClick={onClick}
      className={cn(
        "material-panel flex h-full min-h-[120px] w-full flex-col justify-between px-4 py-3 text-left",
        onClick ? "cursor-pointer transition-all hover:-translate-y-0.5 hover:border-blue-300 hover:shadow-[0_14px_30px_rgba(30,64,175,0.10)]" : "",
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate text-xs font-semibold text-slate-500">{title}</div>
          <div className="mt-1 truncate text-2xl font-bold text-slate-950">{value}</div>
        </div>
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[var(--m3-shape-medium)] border border-blue-200 bg-[linear-gradient(135deg,#ffffff,var(--primary-container))] text-blue-700 shadow-[0_6px_14px_rgba(30,64,175,0.09)]">
          <Icon className="h-4 w-4" />
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
          <div className="truncate text-xs font-medium text-blue-700">{trend}</div>
        ) : (
          <span className="h-[1px]" />
        )}
      </div>
    </Comp>
    </motion.div>
  );
}
