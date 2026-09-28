import { ArrowRight, ShoppingCart } from "lucide-react";
import { Button } from "../components/ui/button";
import { useI18n } from "../lib/i18n";
import type { ProcurementTask } from "../lib/procurementApi";
import { PROC_STATUS_META } from "../procurement/components/common";
import { cn } from "../components/ui/utils";

export function RdProcurementProgressEntry({ task, rdTaskTitle, onOpen }: {
  task: ProcurementTask;
  rdTaskTitle: string;
  onOpen: () => void;
}) {
  const { t } = useI18n();
  const status = PROC_STATUS_META[task.status];
  return (
    <div className="rd-workspace-procurement-entry flex min-w-0 flex-wrap items-center justify-between gap-x-3 gap-y-1.5 rounded-lg bg-slate-50 px-2.5 py-1.5">
      <div className="flex min-w-0 flex-wrap items-center gap-2 text-xs">
        <span className="inline-flex items-center gap-1.5 text-slate-500">
          <ShoppingCart className="size-3.5 shrink-0" aria-hidden="true" />
          {t("采购状态")}
        </span>
        <span className={cn("rounded-full border px-2 py-0.5 font-medium", status?.pill ?? "border-slate-200 text-slate-600")}>
          {t(status?.label ?? task.status)}
        </span>
      </div>
      <Button
        type="button"
        variant="ghost"
        aria-label={t("查看 {task} 的采购进度", { task: rdTaskTitle })}
        onClick={(event) => { event.stopPropagation(); onOpen(); }}
        className="min-h-8 h-auto shrink-0 gap-1 rounded-md px-1.5 py-1 text-xs font-semibold text-primary hover:bg-accent focus-visible:ring-2 focus-visible:ring-primary"
      >
        {t("查看采购进度")}<ArrowRight className="size-3.5" aria-hidden="true" />
      </Button>
    </div>
  );
}
